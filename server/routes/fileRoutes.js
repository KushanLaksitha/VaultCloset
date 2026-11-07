const router = require('express').Router();
const db = require('../config/db');
const storage = require('../services/storageService');
const upload = require('../middleware/fileUploadMiddleware');
const requireAuth = require('../middleware/authMiddleware');
const { newVault, openVault, sha256, decryptCategory } = require('../services/encryptionService');
const { log, categoryAllowed, getCategories } = require('../services/imageService');
const { signFile, verify } = require('../utils/tokens');
const { AppError, wrap, safeName } = require('../utils/errors');

router.use(requireAuth);

const getUnlocked = (req) =>
  String(req.headers['x-unlocked-categories'] || '')
    .split(',')
    .map((s) => +s.trim())
    .filter(Boolean);

// Detect whether file is video or document
function detectFileType(mimetype, filename) {
  if (mimetype && (mimetype.startsWith('video/') || mimetype.includes('matroska') || mimetype.includes('quicktime'))) {
    return 'video';
  }
  if (/\.(mp4|webm|mov|mkv|avi|3gp|m4v|wmv|flv)$/i.test(filename)) {
    return 'video';
  }
  return 'document';
}

// ---------- 1. Upload files (Manual only, Zero AI scan) ----------
router.post('/upload', upload.array('files', 20), wrap(async (req, res) => {
  if (!req.files?.length) throw new AppError(400, 'No files received');
  const specifiedCatId = +req.body.categoryId || null;

  let selectedCat = null;
  if (specifiedCatId) {
    const [[c]] = await db.query(
      'SELECT id, name, target_type, pin_hash FROM categories WHERE id=? AND user_id=?',
      [specifiedCatId, req.user.id]
    );
    selectedCat = c || null;
  }

  const results = [];
  for (const file of req.files) {
    const filename = safeName(file.originalname);
    try {
      const hash = sha256(file.buffer);
      const fileType = detectFileType(file.mimetype, filename);

      // Determine target category for this specific file
      let targetCatId = selectedCat?.id;
      let targetCatName = selectedCat ? decryptCategory(selectedCat.name, req.user.id) : null;

      // If category wasn't provided or its target_type doesn't match this file's type,
      // route to user's default category of the matching type (video or document)
      if (!selectedCat || selectedCat.target_type !== fileType) {
        const [matchingCats] = await db.query(
          'SELECT id, name, pin_hash FROM categories WHERE user_id=? AND target_type=? ORDER BY is_default DESC, id ASC LIMIT 1',
          [req.user.id, fileType]
        );
        if (matchingCats.length) {
          targetCatId = matchingCats[0].id;
          targetCatName = decryptCategory(matchingCats[0].name, req.user.id);
          if (matchingCats[0].pin_hash && !getUnlocked(req).includes(targetCatId)) {
            throw new AppError(403, `This ${fileType} folder is password protected. Enter PIN to upload.`, 'LOCKED_CATEGORY');
          }
        } else {
          throw new AppError(400, `No ${fileType} category found for your account. Please create one first.`);
        }
      } else {
        // Verify PIN if selected category is locked
        if (selectedCat.pin_hash && !getUnlocked(req).includes(selectedCat.id)) {
          throw new AppError(403, 'This folder is password protected. Enter PIN to upload.', 'LOCKED_CATEGORY');
        }
      }

      // Duplicate check strictly by content hash
      const [dup] = await db.query(
        `SELECT vf.id, vf.original_filename, c.name AS category_name
         FROM vault_files vf JOIN categories c ON c.id=vf.category_id
         WHERE vf.user_id=? AND vf.content_hash=?`,
        [req.user.id, hash]
      );

      if (dup.length) {
        const catName = decryptCategory(dup[0].category_name, req.user.id);
        results.push({
          filename,
          status: 'duplicate',
          duplicate: true,
          fileId: dup[0].id,
          category: catName,
          message: `Already in your vault in “${catName}”`,
        });
        continue;
      }

      // AES-256-GCM zero-knowledge encryption
      const v = newVault();
      const encBuf = v.encrypt(file.buffer);
      const encFileRef = await storage.save('vault', req.user.id, encBuf);

      const mimeType = file.mimetype || (fileType === 'video' ? 'video/mp4' : 'application/octet-stream');

      const [r] = await db.query(
        `INSERT INTO vault_files (
          user_id, category_id, original_filename, enc_file_ref, wrapped_key,
          content_hash, mime_type, file_type, file_size
        ) VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          req.user.id,
          targetCatId,
          filename,
          encFileRef,
          v.wrappedKey,
          hash,
          mimeType,
          fileType,
          file.buffer.length,
        ]
      );

      await log(req.user.id, 'file_added', filename);
      results.push({
        filename,
        status: 'saved',
        fileId: r.insertId,
        category: targetCatName,
        fileType,
        size: file.buffer.length,
      });
    } catch (e) {
      console.error('File upload error:', e);
      results.push({
        filename,
        status: 'failed',
        message: e.message || 'Error saving file',
      });
    }
  }

  res.json({ results });
}));

// ---------- 2. List / Filter Files ----------
router.get('/', wrap(async (req, res) => {
  const { q, category, type, favorite, sort = 'newest' } = req.query;
  const where = ['vf.user_id=?'];
  const args = [req.user.id];
  const unlocked = getUnlocked(req);

  if (q) {
    where.push('vf.original_filename LIKE ?');
    args.push(`%${String(q).slice(0, 80)}%`);
  }

  if (['video', 'document'].includes(type)) {
    where.push('vf.file_type=?');
    args.push(type);
  }

  if (favorite === '1') {
    where.push('vf.is_favorite=1');
  }

  if (category) {
    const [[cRow]] = await db.query('SELECT id, pin_hash FROM categories WHERE id=? AND user_id=?', [+category, req.user.id]);
    if (cRow?.pin_hash && !unlocked.includes(+category)) {
      throw new AppError(403, 'This category is password protected. Enter PIN to view.', 'LOCKED_CATEGORY');
    }
    where.push('vf.category_id=?');
    args.push(+category);
  } else {
    // Exclude files from locked categories that are not unlocked in session
    const [lockedCats] = await db.query('SELECT id FROM categories WHERE pin_hash IS NOT NULL AND user_id=?', [req.user.id]);
    const lockedIds = lockedCats.map((c) => c.id).filter((id) => !unlocked.includes(id));
    if (lockedIds.length > 0) {
      where.push('vf.category_id NOT IN (?)');
      args.push(lockedIds);
    }
  }

  const order = {
    newest: 'vf.created_at DESC',
    oldest: 'vf.created_at ASC',
    name: 'vf.original_filename ASC',
    size: 'vf.file_size DESC',
  }[sort] || 'vf.created_at DESC';

  const limit = Math.min(100, +req.query.limit || 40);
  const offset = (Math.max(1, +req.query.page || 1) - 1) * limit;

  const fromSql = `FROM vault_files vf JOIN categories c ON c.id=vf.category_id WHERE ${where.join(' AND ')}`;

  const [rows] = await db.query(
    `SELECT vf.id, vf.original_filename AS name, vf.category_id AS categoryId,
            c.name AS categoryName, vf.mime_type AS mimeType, vf.file_type AS fileType,
            vf.file_size AS size, vf.is_favorite AS isFavorite, vf.created_at AS createdAt
     ${fromSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${fromSql}`, args);

  res.json({
    files: rows.map((r) => ({
      ...r,
      categoryName: decryptCategory(r.categoryName, req.user.id),
      viewToken: signFile(req.user.id, r.id, 'stream', 3600),
    })),
    total,
    page: offset / limit + 1,
    limit,
  });
}));

// ---------- 3. Stats for Files ----------
router.get('/stats', wrap(async (req, res) => {
  const uid = req.user.id;
  const [[totals]] = await db.query(
    `SELECT
       COUNT(*) AS totalFiles,
       COALESCE(SUM(CASE WHEN file_type='video' THEN 1 ELSE 0 END), 0) AS videoCount,
       COALESCE(SUM(CASE WHEN file_type='document' THEN 1 ELSE 0 END), 0) AS docCount,
       COALESCE(SUM(file_size), 0) AS totalBytes,
       COALESCE(SUM(is_favorite), 0) AS favorites
     FROM vault_files WHERE user_id=?`,
    [uid]
  );

  res.json({
    totalFiles: Number(totals.totalFiles || 0),
    videoCount: Number(totals.videoCount || 0),
    docCount: Number(totals.docCount || 0),
    totalBytes: Number(totals.totalBytes || 0),
    favorites: Number(totals.favorites || 0),
  });
}));

// ---------- 4. Request View/Download Token ----------
router.post('/:id/download-token', wrap(async (req, res) => {
  const [[file]] = await db.query(
    `SELECT vf.id, vf.original_filename, vf.mime_type, vf.category_id, c.pin_hash AS catPinHash
     FROM vault_files vf JOIN categories c ON c.id=vf.category_id
     WHERE vf.id=? AND vf.user_id=?`,
    [req.params.id, req.user.id]
  );

  if (!file) throw new AppError(404, 'File not found');

  if (file.catPinHash && !getUnlocked(req).includes(file.category_id)) {
    throw new AppError(403, 'This file is inside a password protected category', 'LOCKED_CATEGORY');
  }

  const token = signFile(req.user.id, file.id, 'stream', 3600);
  res.json({
    url: `/api/files/stream/${token}`,
    filename: file.original_filename,
    mimeType: file.mime_type,
    expiresIn: 3600,
  });
}));

// ---------- 5. Stream / Download File with Range (for Video Player) ----------
router.get('/stream/:token', wrap(async (req, res) => {
  let p;
  try {
    p = verify(req.params.token);
    if (p.t !== 'file') throw 0;
  } catch {
    throw new AppError(401, 'File link has expired or is invalid', 'EXPIRED_TOKEN');
  }

  if (p.sub !== req.user.id) {
    throw new AppError(403, 'Cross-user file access is prohibited', 'FORBIDDEN');
  }

  const [[row]] = await db.query(
    'SELECT * FROM vault_files WHERE id=? AND user_id=?',
    [p.fileId, req.user.id]
  );
  if (!row) throw new AppError(404, 'File not found');

  const encBlob = await storage.read('vault', row.enc_file_ref);
  const plain = openVault(row.wrapped_key).decrypt(encBlob);
  const totalLength = plain.length;

  const encodedFilename = encodeURIComponent(row.original_filename);

  const baseHeaders = {
    'Content-Type': row.mime_type || 'application/octet-stream',
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename="${row.original_filename.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodedFilename}`,
    'Accept-Ranges': 'bytes',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };

  // HTTP Range request support for smooth video streaming and seeking
  const rangeHeader = req.headers.range;
  if (rangeHeader && rangeHeader.startsWith('bytes=')) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

    if (start >= totalLength || end >= totalLength || start > end) {
      res.status(416).set({
        'Content-Range': `bytes */${totalLength}`,
      }).end();
      return;
    }

    const chunk = plain.subarray(start, end + 1);
    res.status(206).set({
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${totalLength}`,
      'Content-Length': chunk.length,
    }).send(chunk);
    return;
  }

  res.status(200).set({
    ...baseHeaders,
    'Content-Length': totalLength,
  }).send(plain);
}));

// ---------- 6. Favorite / Unfavorite ----------
router.post('/:id/favorite', wrap(async (req, res) => {
  const [r] = await db.query(
    'UPDATE vault_files SET is_favorite = IF(?, ?, 1 - is_favorite) WHERE id=? AND user_id=?',
    [req.body.value !== undefined, req.body.value ? 1 : 0, req.params.id, req.user.id]
  );
  if (!r.affectedRows) throw new AppError(404, 'File not found');
  const [[row]] = await db.query('SELECT is_favorite AS isFavorite FROM vault_files WHERE id=?', [req.params.id]);
  res.json({ isFavorite: !!row.isFavorite });
}));

// ---------- 7. Change Category ----------
router.patch('/:id/category', wrap(async (req, res) => {
  const categoryId = +req.body.categoryId;
  if (!(await categoryAllowed(req.user.id, categoryId))) {
    throw new AppError(404, 'That category no longer exists');
  }
  const [r] = await db.query('UPDATE vault_files SET category_id=? WHERE id=? AND user_id=?', [categoryId, req.params.id, req.user.id]);
  if (!r.affectedRows) throw new AppError(404, 'File not found');
  res.json({ ok: true });
}));

// ---------- 8. Delete File (DoD Shredding + DB Unlink) ----------
router.delete('/:id', wrap(async (req, res) => {
  const [[file]] = await db.query('SELECT id, enc_file_ref, original_filename FROM vault_files WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!file) throw new AppError(404, 'File not found');

  await storage.remove('vault', file.enc_file_ref);
  await db.query('DELETE FROM vault_files WHERE id=? AND user_id=?', [file.id, req.user.id]);
  await log(req.user.id, 'file_deleted', file.original_filename);

  res.json({ ok: true });
}));

module.exports = router;

