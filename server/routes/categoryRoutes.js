const router = require('express').Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const requireAuth = require('../middleware/authMiddleware');
const { AppError, wrap } = require('../utils/errors');
const { log } = require('../services/imageService');
router.use(requireAuth);

const cleanName = (v) => {
  const n = String(v || '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 60) throw new AppError(400, 'Category name must be 1–60 characters');
  return n;
};
// Check if name already taken for this specific user
const nameTaken = async (uid, name, exceptId = 0) =>
  (await db.query('SELECT id FROM categories WHERE user_id=? AND LOWER(name)=LOWER(?) AND id<>?', [uid, name, exceptId]))[0].length > 0;


// Helper: verify a category belongs to this user
const ownedCat = async (uid, id) => {
  const [[c]] = await db.query('SELECT id, user_id, is_default, pin_hash FROM categories WHERE id=? AND user_id=?', [id, uid]);
  return c || null;
};


router.get('/', wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.is_default AS isDefault, (pin_hash IS NOT NULL) AS hasPin,
       (SELECT COUNT(*) FROM images i WHERE i.category_id=c.id AND i.user_id=?) AS imageCount
     FROM categories c WHERE c.user_id=? ORDER BY c.is_default DESC, c.sort_order, c.name`, [req.user.id, req.user.id]);
  res.json({ categories: rows });
}));


router.post('/', wrap(async (req, res) => {
  const name = cleanName(req.body.name);
  if (await nameTaken(req.user.id, name)) throw new AppError(409, 'You already have a category with that name');
  const [r] = await db.query('INSERT INTO categories (user_id, name) VALUES (?,?)', [req.user.id, name]);
  await log(req.user.id, 'category_created', name);
  res.status(201).json({ category: { id: r.insertId, name, isDefault: 0, hasPin: false, imageCount: 0 } });
}));


router.patch('/:id', wrap(async (req, res) => {
  const name = cleanName(req.body.name);
  if (await nameTaken(req.user.id, name, +req.params.id)) throw new AppError(409, 'You already have a category with that name');
  // All user categories (including seeded defaults) can be renamed since user owns them
  const [r] = await db.query('UPDATE categories SET name=? WHERE id=? AND user_id=?', [name, req.params.id, req.user.id]);
  if (!r.affectedRows) throw new AppError(404, 'Category not found or not yours');
  res.json({ ok: true });
}));


router.delete('/:id', wrap(async (req, res) => {
  // Only the owning user can delete their category
  const [[cat]] = await db.query('SELECT id, name, pin_hash FROM categories WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  if (!cat) throw new AppError(404, 'Category not found or not yours');

  // 1. Verify User Account Password
  const userPassword = String(req.body.userPassword || '');
  if (!userPassword) {
    throw new AppError(400, 'Please enter your account password to authorize category deletion');
  }
  const [[user]] = await db.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  const userOk = user && (await bcrypt.compare(userPassword, user.password_hash));
  if (!userOk) {
    throw new AppError(403, 'User account password is incorrect');
  }

  // 2. Verify Category Password if category is password-protected
  if (cat.pin_hash) {
    const categoryPassword = String(req.body.categoryPassword || '').trim();
    if (!categoryPassword) {
      throw new AppError(400, 'Please enter the category password to authorize deletion');
    }
    const catOk = await bcrypt.compare(categoryPassword, cat.pin_hash);
    if (!catOk) {
      throw new AppError(403, 'Category password is incorrect');
    }
  }

  // Find user's own "Other" category as fallback destination for images
  const [[other]] = await db.query(
    "SELECT id FROM categories WHERE user_id=? AND LOWER(name)='other' AND id<>? LIMIT 1",
    [req.user.id, cat.id]
  );

  // If no "Other" exists (user deleted it too), pick any remaining category
  let fallbackCatId = other?.id;
  if (!fallbackCatId) {
    const [[any]] = await db.query(
      'SELECT id FROM categories WHERE user_id=? AND id<>? LIMIT 1',
      [req.user.id, cat.id]
    );
    fallbackCatId = any?.id;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (fallbackCatId) {
      await conn.query('UPDATE images SET category_id=? WHERE category_id=? AND user_id=?', [fallbackCatId, cat.id, req.user.id]);
    }
    await conn.query('DELETE FROM categories WHERE id=? AND user_id=?', [cat.id, req.user.id]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  await log(req.user.id, 'category_deleted', cat.name);
  res.json({ ok: true });
}));


// ── PIN management ────────────────────────────────────────────────────────────

const WEAK_PINS = new Set([
  '1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '12345', '123456', 'password', 'pass123', 'admin', 'qwerty'
]);

// In-memory brute-force tracker for PIN verification (per user and category)
const pinAttempts = new Map(); // key: `${userId}_${catId}` -> { count: number, lockedUntil: number }

// Set or update PIN on a category (user-owned only; default categories can have PINs too)
router.post('/:id/pin', wrap(async (req, res) => {
  const cat = await ownedCat(req.user.id, +req.params.id);
  if (!cat) throw new AppError(404, 'Category not found');
  const pin = String(req.body.pin || '').trim();
  if (!pin || pin.length < 4 || pin.length > 32) throw new AppError(400, 'Password must be 4–32 characters');
  if (WEAK_PINS.has(pin.toLowerCase())) {
    throw new AppError(400, 'This password is too common and easy to guess. Please choose a stronger password.', 'WEAK_PIN');
  }
  if (cat.pin_hash && req.body.currentPin !== undefined) {
    const ok = await bcrypt.compare(String(req.body.currentPin || '').trim(), cat.pin_hash);
    if (!ok) throw new AppError(403, 'Current password is incorrect');
  }
  const hash = await bcrypt.hash(pin, 10);
  await db.query('UPDATE categories SET pin_hash=? WHERE id=?', [hash, cat.id]);
  pinAttempts.delete(`${req.user.id}_${cat.id}`);
  res.json({ ok: true });
}));

// Remove PIN from a category (requires current PIN to confirm)
router.delete('/:id/pin', wrap(async (req, res) => {
  const cat = await ownedCat(req.user.id, +req.params.id);
  if (!cat) throw new AppError(404, 'Category not found');
  if (!cat.pin_hash) return res.json({ ok: true }); // already no pin
  const pin = String(req.body.pin || '').trim();
  if (!await bcrypt.compare(pin, cat.pin_hash)) throw new AppError(403, 'Wrong password');
  await db.query('UPDATE categories SET pin_hash=NULL WHERE id=?', [cat.id]);
  pinAttempts.delete(`${req.user.id}_${cat.id}`);
  res.json({ ok: true });
}));

// Verify PIN with progressive brute-force lockout (5 tries => 10-minute lockout)
router.post('/:id/pin/verify', wrap(async (req, res) => {
  const cat = await ownedCat(req.user.id, +req.params.id);
  if (!cat) throw new AppError(404, 'Category not found');
  if (!cat.pin_hash) return res.json({ ok: true }); // no pin = always open

  const lockKey = `${req.user.id}_${cat.id}`;
  const now = Date.now();
  const state = pinAttempts.get(lockKey) || { count: 0, lockedUntil: 0 };

  if (state.lockedUntil > now) {
    const remainingMins = Math.ceil((state.lockedUntil - now) / 60000);
    throw new AppError(429, `Too many incorrect attempts. This folder is locked for ${remainingMins} more minute(s).`, 'PIN_LOCKED');
  }

  const pin = String(req.body.pin || '').trim();
  const ok = await bcrypt.compare(pin, cat.pin_hash);

  if (!ok) {
    const newCount = state.count + 1;
    if (newCount >= 5) {
      pinAttempts.set(lockKey, { count: newCount, lockedUntil: now + 10 * 60 * 1000 });
      throw new AppError(429, 'Too many incorrect attempts. This folder is locked for 10 minutes.', 'PIN_LOCKED');
    }
    pinAttempts.set(lockKey, { count: newCount, lockedUntil: 0 });
    const remaining = 5 - newCount;
    throw new AppError(403, `Incorrect password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before temporary lockout.`, 'WRONG_PIN');
  }

  // Success: clear failed attempts
  pinAttempts.delete(lockKey);
  res.json({ ok: true });
}));

module.exports = router;
