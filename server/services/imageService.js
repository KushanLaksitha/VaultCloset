// Shared by "upload" and "manual approve": encrypt -> store files -> write metadata.
const db = require('../config/db');
const storage = require('./storageService');
const { newVault, decryptCategory } = require('./encryptionService');
const { makeThumb, sanitizeImageBuffer, storeFormat } = require('./imageProcessingService');
const { AppError } = require('../utils/errors');


const log = (userId, action, detail) =>
  db.query('INSERT INTO activity_logs (user_id, action, detail) VALUES (?,?,?)', [userId, action, String(detail).slice(0, 255)]).catch(() => {});

const getCategories = async (userId, targetType = 'image') => {
  const query = targetType && targetType !== 'all'
    ? 'SELECT id, name, target_type, pin_hash FROM categories WHERE user_id=? AND target_type=?'
    : 'SELECT id, name, target_type, pin_hash FROM categories WHERE user_id=?';
  const args = targetType && targetType !== 'all' ? [userId, targetType] : [userId];
  const [rows] = await db.query(query, args);
  return rows.map((r) => ({ ...r, name: decryptCategory(r.name, userId) }));
};

const categoryAllowed = async (userId, id, targetType = null) => {
  const query = targetType
    ? 'SELECT id FROM categories WHERE id=? AND user_id=? AND target_type=?'
    : 'SELECT id FROM categories WHERE id=? AND user_id=?';
  const args = targetType ? [id, userId, targetType] : [id, userId];
  return (await db.query(query, args))[0].length > 0;
};


async function saveApproved({ userId, buffer, filename, categoryId, approvalSource, categorySource, info, hash, ai, aiVerdict }) {
  const v = newVault(); let fileRef, thumbRef;
  try {
    const cleanBuf = await sanitizeImageBuffer(buffer, info.format || 'jpeg');
    const thumb = await makeThumb(cleanBuf);
    fileRef = await storage.save('vault', userId, v.encrypt(cleanBuf));
    thumbRef = await storage.save('vault', userId, v.encrypt(thumb));
    // HEIC/HEIF/AVIF/GIF etc. get converted to JPEG by sanitizeImageBuffer — update stored mime type accordingly
    const storedFormat = storeFormat(info.format || 'jpeg');
    const storedMime = `image/${storedFormat}`;
    const [r] = await db.query(
      `INSERT INTO images (user_id, category_id, original_filename, enc_file_ref, enc_thumb_ref, wrapped_key, content_hash,
        mime_type, file_size, width, height, approval_source, category_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [userId, categoryId, filename, fileRef, thumbRef, v.wrappedKey, hash, storedMime, cleanBuf.length, info.width, info.height, approvalSource, categorySource]);
    await db.query(
      'INSERT INTO ai_analysis (image_id, provider, verdict, suggested_category, confidence, reason, raw_result, input_tokens, output_tokens) VALUES (?,?,?,?,?,?,?,?,?)',
      [r.insertId, ai.provider || 'unknown', aiVerdict, ai.category, ai.confidence, ai.reason, JSON.stringify(ai), ai.inputTokens ?? null, ai.outputTokens ?? null]);
    return r.insertId;
  } catch (e) {
    if (fileRef) await storage.remove('vault', fileRef); if (thumbRef) await storage.remove('vault', thumbRef);
    if (e.code === 'ER_DUP_ENTRY') throw new AppError(409, 'This image is already in your collection', 'DUPLICATE');
    throw e;
  }
}


async function saveRejected({ userId, buffer, filename, info, hash, ai, ttlHours }) {
  const v = newVault();
  const fileRef = await storage.save('tmp', userId, v.encrypt(buffer));
  const thumbRef = await storage.save('tmp', userId, v.encrypt(await makeThumb(buffer)));
  const [r] = await db.query(
    `INSERT INTO rejected_images (user_id, original_filename, enc_file_ref, enc_thumb_ref, wrapped_key, content_hash, mime_type,
      file_size, reason, ai_result, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?, DATE_ADD(NOW(), INTERVAL ? HOUR))`,
    [userId, filename, fileRef, thumbRef, v.wrappedKey, hash, info.mime, buffer.length, ai.reason, JSON.stringify(ai), ttlHours]);
  await db.query('INSERT INTO ai_analysis (rejected_image_id, provider, verdict, suggested_category, confidence, reason, raw_result, input_tokens, output_tokens) VALUES (?,?,?,?,?,?,?,?,?)',
    [r.insertId, ai.provider || 'unknown', 'rejected', ai.category, ai.confidence, ai.reason, JSON.stringify(ai), ai.inputTokens ?? null, ai.outputTokens ?? null]);
  return r.insertId;
}

async function savePending({ userId, buffer, filename, info, hash }) {
  const v = newVault();
  let fileRef, thumbRef;
  try {
    const thumb = await makeThumb(buffer);
    fileRef = await storage.save('pending', userId, v.encrypt(buffer));
    thumbRef = await storage.save('pending', userId, v.encrypt(thumb));
    const [r] = await db.query(
      `INSERT INTO pending_images (user_id, original_filename, enc_file_ref, enc_thumb_ref, wrapped_key,
        content_hash, mime_type, file_size, width, height, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'pending')
       ON DUPLICATE KEY UPDATE status='pending', updated_at=NOW()`,
      [userId, filename, fileRef, thumbRef, v.wrappedKey, hash, info.mime, buffer.length, info.width, info.height]);
    return r.insertId || null;
  } catch (e) {
    if (fileRef) await storage.remove('pending', fileRef).catch(() => {});
    if (thumbRef) await storage.remove('pending', thumbRef).catch(() => {});
    throw e;
  }
}

async function retryPending(userId, pendingId, provider, cats) {
  const { makeAiSample, inspect } = require('./imageProcessingService');
  const { openVault } = require('./encryptionService');
  const env = require('../config/env');

  const [[row]] = await db.query(
    'SELECT * FROM pending_images WHERE id=? AND user_id=? AND status=?',
    [pendingId, userId, 'pending']
  );
  if (!row) return null;

  // Decrypt the stored buffer
  const encBuf = await storage.read('pending', row.enc_file_ref);
  const buffer = openVault(row.wrapped_key).decrypt(encBuf);
  const info = await inspect(buffer);
  const sample = await makeAiSample(buffer);
  const ai = { ...(await provider.analyze(sample, cats.map((c) => c.name))), provider: provider.name };

  let result;
  if (ai.explicit) {
    const rejectedId = await saveRejected({
      userId, buffer, filename: row.original_filename, info,
      hash: row.content_hash, ai, ttlHours: env.rejectedTtlHours,
    });
    result = { status: 'rejected', rejectedId, message: ai.reason || 'Flagged as explicit', ai };
  } else {
    const cat = cats.find((c) => c.name === ai.category) || cats.find((c) => c.name === 'Other');
    const imageId = await saveApproved({
      userId, buffer, filename: row.original_filename,
      categoryId: cat.id, approvalSource: 'ai', categorySource: 'ai',
      info, hash: row.content_hash, ai, aiVerdict: 'approved',
    });
    await log(userId, 'image_added', `${row.original_filename} (retry)`);
    result = { status: 'approved', imageId, category: cat.name, ai };
  }

  // Remove the pending record and its encrypted files
  await storage.remove('pending', row.enc_file_ref).catch(() => {});
  await storage.remove('pending', row.enc_thumb_ref).catch(() => {});
  await db.query('DELETE FROM pending_images WHERE id=?', [pendingId]);

  return result;
}

async function purgeExpiredRejected() {
  const [rows] = await db.query('SELECT id, enc_file_ref, enc_thumb_ref FROM rejected_images WHERE expires_at < NOW()');
  for (const r of rows) { await storage.remove('tmp', r.enc_file_ref); await storage.remove('tmp', r.enc_thumb_ref); }
  if (rows.length) await db.query('DELETE FROM rejected_images WHERE id IN (?)', [rows.map((r) => r.id)]);
}

module.exports = { log, getCategories, categoryAllowed, saveApproved, saveRejected, savePending, retryPending, purgeExpiredRejected };
