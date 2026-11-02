const router = require('express').Router();
const db = require('../config/db');
const env = require('../config/env');
const storage = require('../services/storageService');
const upload = require('../middleware/uploadMiddleware');
const requireAuth = require('../middleware/authMiddleware');
const { inspect, makeAiSample } = require('../services/imageProcessingService');
const { sha256, decryptCategory } = require('../services/encryptionService');
const { getProvider, AiError } = require('../services/aiService');
const svc = require('../services/imageService');
const { signMedia } = require('../utils/tokens');
const { AppError, wrap, safeName } = require('../utils/errors');
router.use(requireAuth);

const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Number.isInteger))].slice(0, 500);
const withThumb = (uid) => (r) => ({ ...r, thumbToken: signMedia(uid, r.id, 'thumb', 600) });

// ---------- Upload + AI pipeline (client sends files one by one so it can show progress) ----------
async function processOne(userId, file, cats) {
  const filename = safeName(file.originalname);
  try {
    const info = await inspect(file.buffer);
    const hash = sha256(file.buffer);
    // Duplicate check strictly by SHA-256 content hash, never by name
    const [dup] = await db.query(
      `SELECT i.id, i.original_filename, c.name AS category_name
       FROM images i JOIN categories c ON c.id=i.category_id
       WHERE i.user_id=? AND i.content_hash=?`,
      [userId, hash]
    );
    if (dup.length) {
      const catName = decryptCategory(dup[0].category_name, userId);
      return {
        filename,
        status: 'approved',
        duplicate: true,
        imageId: dup[0].id,
        category: catName,
        message: `Already in your collection in “${catName}” (Source removed)`,
      };
    }

    const [rej] = await db.query(
      'SELECT id, reason FROM rejected_images WHERE user_id=? AND content_hash=?',
      [userId, hash]
    );
    if (rej.length) {
      return { filename, status: 'rejected', message: `Previously rejected: ${rej[0].reason || 'Flagged as explicit'}` };
    }

    const provider = getProvider();
    const ai = { ...(await provider.analyze(await makeAiSample(file.buffer), cats.map((c) => c.name))), provider: provider.name };

    if (ai.explicit) {
      const rejectedId = await svc.saveRejected({ userId, buffer: file.buffer, filename, info, hash, ai, ttlHours: env.rejectedTtlHours });
      await svc.log(userId, 'image_rejected', filename);
      return { filename, status: 'rejected', rejectedId, message: ai.reason || 'Flagged as explicit', ai };
    }
    const cat = cats.find((c) => c.name === ai.category) || cats.find((c) => c.name === 'Other');
    const imageId = await svc.saveApproved({ userId, buffer: file.buffer, filename, categoryId: cat.id, approvalSource: 'ai',
      categorySource: 'ai', info, hash, ai, aiVerdict: 'approved' });
    await svc.log(userId, 'image_added', filename);
    return { filename, status: 'approved', imageId, category: cat.name, ai };
  } catch (e) {
    if (e instanceof AppError || e instanceof AiError) return { filename, status: e.code === 'DUPLICATE' ? 'duplicate' : 'failed', message: e.message };
    console.error(e); return { filename, status: 'failed', message: 'Unexpected error while processing this image' };
  }
}

router.post('/upload', upload.array('files', 10), wrap(async (req, res) => {
  if (!req.files?.length) throw new AppError(400, 'No files received');
  const cats = await svc.getCategories(req.user.id);
  const results = [];
  for (const file of req.files) {
    results.push(await processOne(req.user.id, file, cats));
  }
  res.json({ results });
}));

// Check duplicates in advance strictly by SHA-256 hash (never by filename)
router.post('/check-duplicates', wrap(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.json({ duplicates: [] });

  const hashes = items.map((it) => it.hash).filter(Boolean);
  let duplicates = [];

  if (hashes.length > 0) {
    const [rows] = await db.query(
      `SELECT i.content_hash AS hash, i.original_filename AS filename, i.file_size AS fileSize, c.name AS categoryName
       FROM images i JOIN categories c ON c.id=i.category_id
       WHERE i.user_id=? AND i.content_hash IN (?)`,
      [req.user.id, hashes]
    );
    duplicates = rows.map((r) => ({
      ...r,
      categoryName: decryptCategory(r.categoryName, req.user.id),
      matchedBy: 'content_hash',
    }));
  }

  res.json({ duplicates });
}));

router.post('/retry-pending', wrap(async (req, res) => {
  const { pendingIds } = req.body;
  if (!Array.isArray(pendingIds) || !pendingIds.length) return res.json({ results: [] });
  const cats = await svc.getCategories(req.user.id);
  const provider = getProvider();
  const results = [];
  for (const pid of pendingIds) {
    try {
      const r = await svc.retryPending(req.user.id, pid, provider, cats);
      results.push({ pendingId: pid, ...r });
    } catch (e) {
      results.push({ pendingId: pid, status: 'failed', message: e.message });
    }
  }
  res.json({ results });
}));


// Helper to parse unlocked categories sent from client session
const getUnlocked = (req) =>
  String(req.headers['x-unlocked-categories'] || '')
    .split(',')
    .map((s) => +s.trim())
    .filter(Boolean);

// ---------- Manual upload (AI skipped — user picks category directly) ----------
router.post('/upload-manual', upload.array('files', 10), wrap(async (req, res) => {
  if (!req.files?.length) throw new AppError(400, 'No files received');
  const categoryId = +req.body.categoryId;
  if (!categoryId || !(await svc.categoryAllowed(req.user.id, categoryId))) throw new AppError(400, 'Invalid category');
  const cats = await svc.getCategories(req.user.id);
  const cat = cats.find((c) => c.id === categoryId);
  if (!cat) throw new AppError(400, 'Invalid category');

  // Verify PIN if folder is password-protected
  if (cat.pin_hash && !getUnlocked(req).includes(categoryId)) {
    throw new AppError(403, 'This category is password protected. Please unlock it before uploading.', 'LOCKED_CATEGORY');
  }

  const results = [];
  for (const file of req.files) {
    const filename = safeName(file.originalname);
    try {
      const info = await inspect(file.buffer);
      const hash = sha256(file.buffer);
      const [dup] = await db.query(
        `SELECT i.id, i.original_filename, c.name AS category_name
         FROM images i JOIN categories c ON c.id=i.category_id
         WHERE i.user_id=? AND i.content_hash=?`,
        [req.user.id, hash]
      );
      if (dup.length) {
        const catName = decryptCategory(dup[0].category_name, req.user.id);
        results.push({
          filename,
          status: 'approved',
          duplicate: true,
          imageId: dup[0].id,
          category: catName,
          message: `Already in your collection in “${catName}” (Source removed)`,
        });
        continue;
      }
      const imageId = await svc.saveApproved({
        userId: req.user.id, buffer: file.buffer, filename,
        categoryId, approvalSource: 'manual', categorySource: 'manual',
        info, hash, ai: { provider: 'none', category: cat.name, confidence: 1, reason: 'Manual upload', explicit: false, labels: [] }, aiVerdict: 'approved',
      });
      await svc.log(req.user.id, 'manually_approved', `${filename}`);
      results.push({ filename, status: 'approved', imageId, category: cat.name });
    } catch (e) {
      if (e instanceof AppError || e instanceof AiError) results.push({ filename, status: e.code === 'DUPLICATE' ? 'duplicate' : 'failed', message: e.message });
      else { console.error(e); results.push({ filename, status: 'failed', message: 'Unexpected error while saving this image' }); }
    }
  }
  res.json({ results });
}));

// ---------- Direct Local PC Folder Import (Reads folder, saves to vault, and unlinks source files) ----------
router.post('/import-local-folder', wrap(async (req, res) => {
  const { folderPath, categoryId, mode = 'ai' } = req.body;
  if (!folderPath || typeof folderPath !== 'string') {
    throw new AppError(400, 'Please provide a valid folder path on your computer');
  }

  const fs = require('fs');
  const path = require('path');
  const resolved = path.resolve(folderPath.trim());

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new AppError(404, `Local folder not found: ${resolved}`);
  }

  const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
  const imageFiles = entries
    .filter((e) => e.isFile() && /\.(jpe?g|png|webp)$/i.test(e.name))
    .map((e) => path.join(resolved, e.name));

  if (!imageFiles.length) {
    return res.json({ message: 'No JPG, PNG, or WEBP images found in this folder', results: [] });
  }

  const cats = await svc.getCategories(req.user.id);
  const results = [];

  for (const filePath of imageFiles) {
    const filename = path.basename(filePath);
    try {
      const buffer = await fs.promises.readFile(filePath);
      const fakeFile = { originalname: filename, buffer };

      let r;
      if (mode === 'manual' && categoryId) {
        const cat = cats.find((c) => c.id === +categoryId);
        if (!cat) throw new AppError(400, 'Invalid category selected');
        const info = await inspect(buffer);
        const hash = sha256(buffer);
        const [dup] = await db.query(
          `SELECT i.id, i.original_filename, c.name AS category_name
           FROM images i JOIN categories c ON c.id=i.category_id
           WHERE i.user_id=? AND i.content_hash=?`,
          [req.user.id, hash]
        );
        if (dup.length) {
          const catName = decryptCategory(dup[0].category_name, req.user.id);
          r = { filename, status: 'approved', duplicate: true, category: catName, message: 'Already in collection (Source removed)' };
        } else {
          const imageId = await svc.saveApproved({
            userId: req.user.id, buffer, filename: safeName(filename),
            categoryId: +categoryId, approvalSource: 'manual', categorySource: 'manual',
            info, hash, ai: { provider: 'none', category: cat.name, confidence: 1, reason: 'Local folder import', explicit: false, labels: [] },
            aiVerdict: 'approved'
          });
          r = { filename, status: 'approved', imageId, category: cat.name };
        }
      } else {
        r = await processOne(req.user.id, fakeFile, cats);
      }

      // Secure Shredding: Overwrite with random bytes + zeros before unlinking so recovery is impossible
      if (r && (r.status === 'approved' || r.duplicate || r.status === 'rejected')) {
        try {
          await shredFile(filePath);
          r.deletedFromSource = true;
          r.shredded = true;
        } catch (delErr) {
          r.deleteError = delErr.message;
        }
      }

      results.push(r);
    } catch (err) {
      results.push({ filename, status: 'failed', message: err.message });
    }
  }

  res.json({ results });
}));

// Helper: Secure file shredder (multi-pass random + zero overwrite before unlink)
async function shredFile(filePath) {
  const fs = require('fs');
  const crypto = require('crypto');
  try {
    const stat = await fs.promises.stat(filePath);
    const size = stat.size;
    if (size > 0) {
      const fd = await fs.promises.open(filePath, 'r+');
      try {
        const chunkSize = Math.min(size, 256 * 1024);
        // Pass 1: Cryptographic pseudo-random bytes
        let offset = 0;
        while (offset < size) {
          const currentChunk = Math.min(chunkSize, size - offset);
          await fd.write(crypto.randomBytes(currentChunk), 0, currentChunk, offset);
          offset += currentChunk;
        }
        await fd.sync();

        // Pass 2: Overwrite with zeros
        const zeroBuf = Buffer.alloc(chunkSize, 0);
        offset = 0;
        while (offset < size) {
          const currentChunk = Math.min(chunkSize, size - offset);
          await fd.write(zeroBuf, 0, currentChunk, offset);
          offset += currentChunk;
        }
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
  } catch (err) {
    console.warn('Shred overwrite error:', err.message);
  }
  await fs.promises.unlink(filePath);
}


// ---------- Dashboard statistics ----------
router.get('/stats', wrap(async (req, res) => {
  const u = req.user.id;
  const [[t]] = await db.query('SELECT COUNT(*) total, COALESCE(SUM(file_size),0) bytes, COALESCE(SUM(is_favorite),0) favorites FROM images WHERE user_id=?', [u]);
  const [[c]] = await db.query('SELECT COUNT(*) n FROM categories WHERE user_id=?', [u]);
  const [[rj]] = await db.query('SELECT COUNT(*) n FROM rejected_images WHERE user_id=?', [u]);
  const [byCategory] = await db.query(
    `SELECT c.name, COUNT(i.id) count FROM categories c LEFT JOIN images i ON i.category_id=c.id AND i.user_id=?
     WHERE c.user_id=? GROUP BY c.id ORDER BY count DESC LIMIT 8`, [u, u]);
  const decryptedByCategory = byCategory.map((b) => ({ ...b, name: decryptCategory(b.name, u) }));

  const [recent] = await db.query('SELECT id, original_filename FROM images WHERE user_id=? ORDER BY created_at DESC LIMIT 8', [u]);
  const [activity] = await db.query('SELECT action, detail, created_at FROM activity_logs WHERE user_id=? ORDER BY id DESC LIMIT 8', [u]);
  res.json({ total: t.total, storageBytes: Number(t.bytes), favorites: Number(t.favorites), categories: c.n, rejected: rj.n,
    byCategory: decryptedByCategory, recent: recent.map(withThumb(u)), activity });
}));

// ---------- List / search / filter ----------
router.get('/', wrap(async (req, res) => {
  const { q, category, favorite, approval, catSource, aiClass, from, to, sort = 'newest' } = req.query;
  const where = ['i.user_id=?'], args = [req.user.id];
  const unlocked = getUnlocked(req);

  if (q) { where.push('i.original_filename LIKE ?'); args.push(`%${String(q).slice(0, 80)}%`); }
  if (category) {
    const [[cRow]] = await db.query('SELECT id, pin_hash FROM categories WHERE id=? AND user_id=?', [+category, req.user.id]);
    if (cRow?.pin_hash && !unlocked.includes(+category)) {
      throw new AppError(403, 'This category is password protected. Enter PIN to view.', 'LOCKED_CATEGORY');
    }
    where.push('i.category_id=?'); args.push(+category);
  } else {
    // If viewing all categories, exclude photos from password-protected categories that aren't unlocked
    const [lockedCats] = await db.query('SELECT id FROM categories WHERE pin_hash IS NOT NULL AND user_id=?', [req.user.id]);

    const lockedIds = lockedCats.map((c) => c.id).filter((id) => !unlocked.includes(id));
    if (lockedIds.length > 0) {
      where.push('i.category_id NOT IN (?)');
      args.push(lockedIds);
    }
  }
  if (favorite === '1') where.push('i.is_favorite=1');
  if (['ai', 'manual'].includes(approval)) { where.push('i.approval_source=?'); args.push(approval); }
  if (['ai', 'manual'].includes(catSource)) { where.push('i.category_source=?'); args.push(catSource); }
  if (aiClass) { where.push('a.suggested_category=?'); args.push(String(aiClass)); }
  if (from) { where.push('i.created_at>=?'); args.push(from); }
  if (to) { where.push('i.created_at<?'); args.push(`${to} 23:59:59`); }
  const order = { newest: 'i.created_at DESC', oldest: 'i.created_at ASC', name: 'i.original_filename ASC' }[sort] || 'i.created_at DESC';
  const limit = Math.min(100, +req.query.limit || 40), offset = (Math.max(1, +req.query.page || 1) - 1) * limit;
  const from_ = `FROM images i JOIN categories c ON c.id=i.category_id LEFT JOIN ai_analysis a ON a.image_id=i.id WHERE ${where.join(' AND ')}`;
  const [rows] = await db.query(
    `SELECT i.id, i.original_filename AS name, i.category_id AS categoryId, c.name AS categoryName, i.is_favorite AS isFavorite,
     i.approval_source AS approval, i.category_source AS catSource, i.file_size AS size, i.width, i.height, i.created_at AS createdAt,
     a.suggested_category AS aiCategory, a.confidence ${from_} ORDER BY ${order} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [[{ total }]] = await db.query(`SELECT COUNT(*) total ${from_}`, args);
  res.json({
    images: rows.map((r) => ({
      ...withThumb(req.user.id)(r),
      categoryName: decryptCategory(r.categoryName, req.user.id),
    })),
    total,
    page: offset / limit + 1,
    limit,
  });
}));

// ---------- Bulk actions ----------
router.post('/bulk-category', wrap(async (req, res) => {
  const list = ids(req.body.ids);
  if (!list.length) throw new AppError(400, 'Select at least one image');
  if (!(await svc.categoryAllowed(req.user.id, req.body.categoryId))) throw new AppError(404, 'That category no longer exists');
  const [r] = await db.query("UPDATE images SET category_id=?, category_source='manual' WHERE user_id=? AND id IN (?)", [req.body.categoryId, req.user.id, list]);
  await svc.log(req.user.id, 'images_moved', `${r.affectedRows} image(s)`);
  res.json({ updated: r.affectedRows });
}));
router.post('/bulk-favorite', wrap(async (req, res) => {
  const list = ids(req.body.ids); if (!list.length) throw new AppError(400, 'Select at least one image');
  await db.query('UPDATE images SET is_favorite=? WHERE user_id=? AND id IN (?)', [req.body.value ? 1 : 0, req.user.id, list]);
  res.json({ ok: true });
}));
async function deleteImages(userId, list) {
  const [rows] = await db.query('SELECT id, enc_file_ref, enc_thumb_ref FROM images WHERE user_id=? AND id IN (?)', [userId, list]);
  if (!rows.length) return 0;
  await db.query('DELETE FROM images WHERE user_id=? AND id IN (?)', [userId, rows.map((r) => r.id)]);
  for (const r of rows) { await storage.remove('vault', r.enc_file_ref); await storage.remove('vault', r.enc_thumb_ref); }
  await svc.log(userId, 'images_deleted', `${rows.length} image(s)`);
  return rows.length;
}
router.post('/bulk-delete', wrap(async (req, res) => {
  const list = ids(req.body.ids); if (!list.length) throw new AppError(400, 'Select at least one image');
  res.json({ deleted: await deleteImages(req.user.id, list) });
}));

// ---------- Single image ----------
router.get('/:id', wrap(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT i.id, i.original_filename AS name, i.mime_type AS mime, i.file_size AS size, i.width, i.height, i.is_favorite AS isFavorite,
     i.category_id AS categoryId, c.name AS categoryName, c.pin_hash AS catPinHash, i.approval_source AS approval, i.category_source AS catSource,
     i.created_at AS createdAt, a.suggested_category AS aiCategory, a.confidence, a.reason
     FROM images i JOIN categories c ON c.id=i.category_id LEFT JOIN ai_analysis a ON a.image_id=i.id WHERE i.id=? AND i.user_id=?`, [req.params.id, req.user.id]);
  if (!r) throw new AppError(404, 'Image not found');
  if (r.catPinHash && !getUnlocked(req).includes(r.categoryId)) {
    throw new AppError(403, 'This image is inside a password protected category', 'LOCKED_CATEGORY');
  }
  delete r.catPinHash;
  r.categoryName = decryptCategory(r.categoryName, req.user.id);
  res.json({ image: r });
}));
// A 60-second, single-purpose link used by the secure viewer. Fetch a new one each time an image opens.
router.post('/:id/view-token', wrap(async (req, res) => {
  const [[r]] = await db.query(
    `SELECT i.id, c.pin_hash AS catPinHash, i.category_id AS categoryId
     FROM images i JOIN categories c ON c.id=i.category_id
     WHERE i.id=? AND i.user_id=?`, [req.params.id, req.user.id]);
  if (!r) throw new AppError(404, 'Image not found');
  if (r.catPinHash && !getUnlocked(req).includes(r.categoryId)) {
    throw new AppError(403, 'This image is inside a password protected category', 'LOCKED_CATEGORY');
  }
  res.json({ url: `/api/media/${signMedia(req.user.id, r.id, 'full', 60)}`, expiresIn: 60 });
}));
router.patch('/:id/category', wrap(async (req, res) => {
  if (!(await svc.categoryAllowed(req.user.id, req.body.categoryId))) throw new AppError(404, 'That category no longer exists');
  const [r] = await db.query("UPDATE images SET category_id=?, category_source='manual' WHERE id=? AND user_id=?", [req.body.categoryId, req.params.id, req.user.id]);
  if (!r.affectedRows) throw new AppError(404, 'Image not found');
  res.json({ ok: true });
}));
router.post('/:id/favorite', wrap(async (req, res) => {
  const [r] = await db.query('UPDATE images SET is_favorite = IF(?, ?, 1 - is_favorite) WHERE id=? AND user_id=?',
    [req.body.value !== undefined, req.body.value ? 1 : 0, req.params.id, req.user.id]);
  if (!r.affectedRows) throw new AppError(404, 'Image not found');
  const [[row]] = await db.query('SELECT is_favorite AS isFavorite FROM images WHERE id=?', [req.params.id]);
  res.json({ isFavorite: !!row.isFavorite });
}));
router.delete('/:id', wrap(async (req, res) => {
  if (!(await deleteImages(req.user.id, [+req.params.id]))) throw new AppError(404, 'Image not found');
  res.json({ ok: true });
}));
module.exports = router;
