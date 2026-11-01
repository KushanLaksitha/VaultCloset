// Decrypts and streams an image ONLY for a valid, unexpired, user-bound token. No path or key ever leaves the server.
const router = require('express').Router();
const db = require('../config/db');
const storage = require('../services/storageService');
const { openVault } = require('../services/encryptionService');
const { verify } = require('../utils/tokens');
const { AppError, wrap } = require('../utils/errors');
const requireAuth = require('../middleware/authMiddleware');

// Enforce session authentication on all media requests
router.use(requireAuth);

router.get('/:token', wrap(async (req, res) => {
  let p;
  try {
    p = verify(req.params.token);
    if (p.t !== 'media') throw 0;
  } catch {
    throw new AppError(401, 'This image link has expired or is invalid', 'EXPIRED_TOKEN');
  }

  // ── ANTI-SHARING ISOLATION ENFORCEMENT ──────────────────────────────────────────
  // The token's owner (p.sub) MUST match the authenticated user making the request.
  // Cross-user photo sharing or viewing another user's media link is strictly forbidden.
  if (p.sub !== req.user.id) {
    throw new AppError(403, 'Sharing photos between accounts is prohibited. This photo belongs to another user.', 'FORBIDDEN_SHARING');
  }

  const rejected = p.kind.startsWith('rejected');
  const pending = p.kind.startsWith('pending');
  const thumb = p.kind.endsWith('thumb');
  const table = rejected ? 'rejected_images' : pending ? 'pending_images' : 'images';
  const area = rejected ? 'tmp' : pending ? 'pending' : 'vault';

  const [[row]] = await db.query(
    `SELECT * FROM ${table} WHERE id=? AND user_id=?`,
    [p.img, req.user.id]
  );
  if (!row) throw new AppError(404, 'Image not found');

  const blob = await storage.read(area, thumb ? row.enc_thumb_ref : row.enc_file_ref);
  const plain = openVault(row.wrapped_key).decrypt(blob);

  res.set({
    'Content-Type': thumb ? 'image/webp' : row.mime_type,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  }).send(plain);
}));

module.exports = router;
