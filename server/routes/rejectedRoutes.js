const router = require('express').Router();
const db = require('../config/db');
const storage = require('../services/storageService');
const requireAuth = require('../middleware/authMiddleware');
const { openVault } = require('../services/encryptionService');
const { inspect } = require('../services/imageProcessingService');
const svc = require('../services/imageService');
const { signMedia } = require('../utils/tokens');
const { AppError, wrap } = require('../utils/errors');
router.use(requireAuth);

router.get('/', wrap(async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, original_filename AS name, reason, ai_result AS ai, file_size AS size, expires_at AS expiresAt, created_at AS createdAt FROM rejected_images WHERE user_id=? ORDER BY id DESC', [req.user.id]);
  res.json({ rejected: rows.map((r) => ({ ...r, thumbToken: signMedia(req.user.id, r.id, 'rejected-thumb', 600) })) });
}));
router.post('/:id/view-token', wrap(async (req, res) => {
  const [[r]] = await db.query('SELECT id FROM rejected_images WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!r) throw new AppError(404, 'Image not found');
  res.json({ url: `/api/media/${signMedia(req.user.id, r.id, 'rejected-full', 60)}` });
}));
router.delete('/:id', wrap(async (req, res) => {
  const [[r]] = await db.query('SELECT * FROM rejected_images WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!r) throw new AppError(404, 'Image not found');
  await storage.remove('tmp', r.enc_file_ref); await storage.remove('tmp', r.enc_thumb_ref);
  await db.query('DELETE FROM rejected_images WHERE id=?', [r.id]);
  res.json({ ok: true });
}));
// Manual approval: the person decides the AI was wrong. The image is re-encrypted into the permanent vault.
router.post('/:id/approve', wrap(async (req, res) => {
  const [[r]] = await db.query('SELECT * FROM rejected_images WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!r) throw new AppError(404, 'Image not found (it may have expired)');
  const cats = await svc.getCategories(req.user.id);
  const categoryId = req.body.categoryId || cats.find((c) => c.name === 'Other').id;
  if (!(await svc.categoryAllowed(req.user.id, categoryId))) throw new AppError(404, 'That category no longer exists');
  const buffer = openVault(r.wrapped_key).decrypt(await storage.read('tmp', r.enc_file_ref));
  const info = await inspect(buffer);
  const ai = typeof r.ai_result === 'string' ? JSON.parse(r.ai_result) : r.ai_result || {};
  const imageId = await svc.saveApproved({ userId: req.user.id, buffer, filename: r.original_filename, categoryId,
    approvalSource: 'manual', categorySource: 'manual', info, hash: r.content_hash, ai, aiVerdict: 'rejected' });
  await storage.remove('tmp', r.enc_file_ref); await storage.remove('tmp', r.enc_thumb_ref);
  await db.query('DELETE FROM rejected_images WHERE id=?', [r.id]);
  await svc.log(req.user.id, 'manually_approved', r.original_filename);
  res.json({ imageId });
}));
module.exports = router;
