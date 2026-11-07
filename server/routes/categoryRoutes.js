const router = require('express').Router();
const crypto = require('crypto');
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const requireAuth = require('../middleware/authMiddleware');
const { AppError, wrap } = require('../utils/errors');
const { log, getCategories } = require('../services/imageService');
const { encryptCategory, decryptCategory } = require('../services/encryptionService');

function getDeviceInfo(ua) {
  if (!ua) return 'Desktop Browser';
  let os = 'Desktop';
  if (/Windows NT 10.0/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT 6.3/i.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6.1/i.test(ua)) os = 'Windows 7';
  else if (/Windows/i.test(ua)) os = 'Windows PC';
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua) && !/Android/i.test(ua)) os = 'Linux PC';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Android/i.test(ua)) os = 'Android Phone';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return `${os} · ${browser}`;
}

// ── Public QR code endpoints for Category Unlock (Accessible before session auth) ──

router.get('/unlock-request-details/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const [[row]] = await db.query(
    `SELECT cur.id, cur.device_info AS deviceInfo, cur.ip_address AS ipAddress, cur.status, cur.expires_at AS expiresAt,
            c.target_type AS targetType, u.username
     FROM category_unlock_requests cur
     JOIN categories c ON c.id = cur.category_id
     JOIN users u ON u.id = cur.user_id
     WHERE cur.id = ?`,
    [id]
  );
  if (!row) throw new AppError(404, 'Category unlock request not found');

  const expired = new Date(row.expiresAt) < new Date();
  if (expired && row.status === 'pending') {
    await db.query("UPDATE category_unlock_requests SET status='expired' WHERE id=?", [id]);
    row.status = 'expired';
  }

  res.json({
    id: row.id,
    deviceInfo: row.deviceInfo,
    ipAddress: row.ipAddress,
    status: row.status,
    targetType: row.targetType,
    username: row.username,
    expiresAt: row.expiresAt,
  });
}));

router.post('/mobile-auth/direct-unlock', wrap(async (req, res) => {
  const { requestId, matchCode, password, confirmPassword, approve } = req.body;
  if (!requestId) throw new AppError(400, 'Missing requestId');

  const [[row]] = await db.query('SELECT * FROM category_unlock_requests WHERE id=?', [requestId]);
  if (!row) throw new AppError(404, 'Category unlock request not found');
  if (row.status !== 'pending' || new Date(row.expires_at) < new Date()) {
    throw new AppError(400, 'This unlock request has already expired or been completed');
  }

  if (approve) {
    const inputCode = String(matchCode || '').replace(/\s+/g, '').trim();
    const expectedCode = String(row.security_code || '').replace(/\s+/g, '').trim();
    if (!inputCode) throw new AppError(400, 'Please enter the 6-digit Security Match Code shown on your laptop screen');
    if (inputCode !== expectedCode) throw new AppError(403, 'Incorrect Security Match Code');

    const pw = String(password || '');
    const confirmPw = String(confirmPassword || '');
    if (!pw || !confirmPw) throw new AppError(400, 'Please enter and confirm your password');
    if (pw !== confirmPw) throw new AppError(400, 'Passwords do not match. Please re-enter both correctly.');

    const [[cat]] = await db.query('SELECT * FROM categories WHERE id=?', [row.category_id]);
    if (!cat) throw new AppError(404, 'Category not found');

    const [[u]] = await db.query('SELECT password_hash FROM users WHERE id=?', [row.user_id]);
    if (!u) throw new AppError(404, 'User not found');

    const catOk = cat.pin_hash ? await bcrypt.compare(pw, cat.pin_hash) : false;
    const userOk = await bcrypt.compare(pw, u.password_hash);
    if (!catOk && !userOk) throw new AppError(403, 'Incorrect password. Folder unlock rejected.');

    await db.query("UPDATE category_unlock_requests SET status='approved' WHERE id=?", [requestId]);
    await log(row.user_id, 'category_mobile_unlocked', `Unlocked folder #${cat.id} via mobile QR unlock`);

    res.json({ ok: true, status: 'approved' });
  } else {
    await db.query("UPDATE category_unlock_requests SET status='rejected' WHERE id=?", [requestId]);
    res.json({ ok: true, status: 'rejected' });
  }
}));

router.use(requireAuth);

const cleanName = (v) => {
  const n = String(v || '').trim().replace(/\s+/g, ' ');
  if (!n || n.length > 60) throw new AppError(400, 'Category name must be 1–60 characters');
  return n;
};

// Check if name already taken for this user within the same targetType
const nameTaken = async (uid, name, targetType = 'image', exceptId = 0) => {
  const cats = await getCategories(uid, targetType);
  return cats.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
};

// Helper: verify a category belongs to this user
const ownedCat = async (uid, id) => {
  const [[c]] = await db.query('SELECT id, user_id, name, target_type, is_default, pin_hash FROM categories WHERE id=? AND user_id=?', [id, uid]);
  return c || null;
};

router.get('/', wrap(async (req, res) => {
  // Parse unlocked category IDs from the request header (client session)
  const unlockedIds = new Set(
    (req.headers['x-unlocked-categories'] || '').split(',').map(Number).filter(Boolean)
  );

  const typeFilter = ['image', 'video', 'document'].includes(req.query.type)
    ? req.query.type
    : null;

  const where = ['c.user_id=?'];
  const args = [req.user.id];

  if (typeFilter) {
    where.push('c.target_type=?');
    args.push(typeFilter);
  }

  const [rows] = await db.query(
    `SELECT c.id, c.name, c.target_type AS targetType, c.is_default AS isDefault, (c.pin_hash IS NOT NULL) AS hasPin,
       CASE
         WHEN c.target_type = 'image' THEN (SELECT COUNT(*) FROM images i WHERE i.category_id=c.id AND i.user_id=?)
         ELSE (SELECT COUNT(*) FROM vault_files vf WHERE vf.category_id=c.id AND vf.user_id=?)
       END AS imageCount
     FROM categories c WHERE ${where.join(' AND ')} ORDER BY c.is_default DESC, c.sort_order, c.name`,
    [req.user.id, req.user.id, ...args]
  );

  const categories = rows.map((r) => {
    const decryptedName = decryptCategory(r.name, req.user.id);
    const isLocked = r.hasPin && !unlockedIds.has(r.id);
    if (isLocked) {
      // Stealth mode: hide name and item count for PIN-locked categories
      return {
        id: r.id,
        name: null,
        targetType: r.targetType,
        isDefault: r.isDefault,
        hasPin: true,
        masked: true,
        imageCount: null,
      };
    }
    return {
      ...r,
      name: decryptedName,
      masked: false,
    };
  });

  res.json({ categories });
}));

router.post('/', wrap(async (req, res) => {
  const targetType = ['image', 'video', 'document'].includes(req.body.type || req.body.target_type)
    ? (req.body.type || req.body.target_type)
    : 'image';
  const name = cleanName(req.body.name);
  if (await nameTaken(req.user.id, name, targetType)) {
    throw new AppError(409, `You already have a ${targetType} category with that name`);
  }
  const encName = encryptCategory(name, req.user.id);
  const [r] = await db.query('INSERT INTO categories (user_id, target_type, name) VALUES (?,?,?)', [req.user.id, targetType, encName]);
  await log(req.user.id, 'category_created', `New ${targetType} category created`);
  res.status(201).json({ category: { id: r.insertId, name, targetType, isDefault: 0, hasPin: false, imageCount: 0 } });
}));

router.patch('/:id', wrap(async (req, res) => {
  const cat = await ownedCat(req.user.id, +req.params.id);
  if (!cat) throw new AppError(404, 'Category not found or not yours');

  const name = cleanName(req.body.name);
  if (await nameTaken(req.user.id, name, cat.target_type, +req.params.id)) {
    throw new AppError(409, 'You already have a category with that name');
  }
  const encName = encryptCategory(name, req.user.id);
  const [r] = await db.query('UPDATE categories SET name=? WHERE id=? AND user_id=?', [encName, req.params.id, req.user.id]);
  if (!r.affectedRows) throw new AppError(404, 'Category not found or not yours');
  await log(req.user.id, 'category_renamed', 'Category renamed');
  res.json({ ok: true });
}));

router.delete('/:id', wrap(async (req, res) => {
  const cat = await ownedCat(req.user.id, +req.params.id);
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

  // Find user's own fallback category for this specific target_type
  const allCats = await getCategories(req.user.id, cat.target_type);
  const other = allCats.find((c) => c.name.toLowerCase().includes('other') && c.id !== cat.id);
  const fallbackCatId = other?.id || allCats.find((c) => c.id !== cat.id)?.id;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (fallbackCatId) {
      if (cat.target_type === 'image') {
        await conn.query('UPDATE images SET category_id=? WHERE category_id=? AND user_id=?', [fallbackCatId, cat.id, req.user.id]);
      } else {
        await conn.query('UPDATE vault_files SET category_id=? WHERE category_id=? AND user_id=?', [fallbackCatId, cat.id, req.user.id]);
      }
    }
    await conn.query('DELETE FROM categories WHERE id=? AND user_id=?', [cat.id, req.user.id]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  await log(req.user.id, 'category_deleted', 'Category deleted');
  res.json({ ok: true });
}));

// ── PIN management ────────────────────────────────────────────────────────────

const WEAK_PINS = new Set([
  '1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '12345', '123456', 'password', 'pass123', 'admin', 'qwerty'
]);

// In-memory brute-force tracker for PIN verification (per user and category)
const pinAttempts = new Map(); // key: `${userId}_${catId}` -> { count: number, lockedUntil: number }

// Set or update PIN on a category (user-owned only)
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

  // Success: clear failed attempts and reveal the real category name + accurate itemCount
  pinAttempts.delete(lockKey);
  const decryptedName = decryptCategory(cat.name, req.user.id);

  let itemCount = 0;
  if (cat.target_type === 'image') {
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM images WHERE category_id=? AND user_id=?', [cat.id, req.user.id]);
    itemCount = r.n;
  } else {
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM vault_files WHERE category_id=? AND user_id=?', [cat.id, req.user.id]);
    itemCount = r.n;
  }

  res.json({ ok: true, name: decryptedName, targetType: cat.target_type, imageCount: Number(itemCount) });
}));


// ── Category Mobile Unlock Gate Endpoints (Authenticated) ──

// Laptop requests mobile authorization to unlock a protected category
router.post('/:id/mobile-unlock-request', wrap(async (req, res) => {
  const cat = await ownedCat(req.user.id, +req.params.id);
  if (!cat) throw new AppError(404, 'Category not found or not yours');

  let itemCount = 0;
  if (cat.target_type === 'image') {
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM images WHERE category_id=? AND user_id=?', [cat.id, req.user.id]);
    itemCount = r.n;
  } else {
    const [[r]] = await db.query('SELECT COUNT(*) AS n FROM vault_files WHERE category_id=? AND user_id=?', [cat.id, req.user.id]);
    itemCount = r.n;
  }

  // If category has no PIN, it's already open
  if (!cat.pin_hash) {
    const decryptedName = decryptCategory(cat.name, req.user.id);
    return res.json({ alreadyUnlocked: true, categoryId: cat.id, name: decryptedName, targetType: cat.target_type, imageCount: Number(itemCount) });
  }

  // Invalidate any older pending requests for this category and user
  await db.query("UPDATE category_unlock_requests SET status='expired' WHERE user_id=? AND category_id=? AND status='pending'", [req.user.id, cat.id]);

  const requestId = crypto.randomUUID();
  const rawCode = String(crypto.randomInt(100000, 999999));
  const securityCode = `${rawCode.slice(0, 3)} ${rawCode.slice(3)}`;
  const deviceInfo = getDeviceInfo(req.headers['user-agent']);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes

  await db.query(
    `INSERT INTO category_unlock_requests (id, user_id, category_id, security_code, status, device_info, ip_address, expires_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [requestId, req.user.id, cat.id, securityCode, deviceInfo, ip, expiresAt]
  );

  await log(req.user.id, 'category_mobile_unlock_requested', `Folder unlock requested via mobile for category #${cat.id} (Code: ${securityCode})`);

  res.json({
    requestId,
    securityCode,
    categoryId: cat.id,
    targetType: cat.target_type,
    deviceInfo,
    expiresIn: 180,
  });
}));


// Poll status of category unlock request (Laptop polls this)
router.get('/unlock-request/:id/status', wrap(async (req, res) => {
  const { id } = req.params;
  const [[row]] = await db.query('SELECT * FROM category_unlock_requests WHERE id=? AND user_id=?', [id, req.user.id]);
  if (!row) return res.json({ status: 'not_found' });

  const now = new Date();
  if (new Date(row.expires_at) < now && row.status === 'pending') {
    await db.query("UPDATE category_unlock_requests SET status='expired' WHERE id=?", [id]);
    return res.json({ status: 'expired' });
  }

  if (row.status === 'approved') {
    const cat = await ownedCat(req.user.id, row.category_id);
    if (!cat) throw new AppError(404, 'Category not found');

    const decryptedName = decryptCategory(cat.name, req.user.id);
    let itemCount = 0;
    if (cat.target_type === 'image') {
      const [[r]] = await db.query('SELECT COUNT(*) AS n FROM images WHERE category_id=? AND user_id=?', [cat.id, req.user.id]);
      itemCount = r.n;
    } else {
      const [[r]] = await db.query('SELECT COUNT(*) AS n FROM vault_files WHERE category_id=? AND user_id=?', [cat.id, req.user.id]);
      itemCount = r.n;
    }

    return res.json({
      status: 'approved',
      categoryId: cat.id,
      name: decryptedName,
      targetType: cat.target_type,
      imageCount: Number(itemCount),
    });
  }

  const remainingSeconds = Math.max(0, Math.round((new Date(row.expires_at) - now) / 1000));
  return res.json({
    status: row.status,
    remainingSeconds,
    securityCode: row.security_code,
  });
}));


// Cancel a pending category unlock request
router.post('/unlock-request/:id/cancel', wrap(async (req, res) => {
  const { id } = req.params;
  await db.query("UPDATE category_unlock_requests SET status='expired' WHERE id=? AND user_id=?", [id, req.user.id]);
  res.json({ ok: true });
}));


// Check for pending category unlock requests (Mobile user polling)
router.get('/mobile-auth/pending', wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT cur.id, cur.category_id AS categoryId, c.target_type AS targetType, cur.device_info AS deviceInfo, cur.ip_address AS ipAddress, cur.created_at AS createdAt, cur.expires_at AS expiresAt
     FROM category_unlock_requests cur
     JOIN categories c ON c.id = cur.category_id
     WHERE cur.user_id=? AND cur.status='pending' AND cur.expires_at > NOW()
     ORDER BY cur.created_at DESC LIMIT 1`,
    [req.user.id]
  );
  res.json({ pendingCategoryRequest: rows[0] || null });
}));


// Approve or reject category unlock request from mobile app
router.post('/mobile-auth/respond', wrap(async (req, res) => {
  const { requestId, approve, matchCode, password, confirmPassword } = req.body;
  if (!requestId) throw new AppError(400, 'Missing requestId');

  const [[row]] = await db.query(
    'SELECT * FROM category_unlock_requests WHERE id=? AND user_id=?',
    [requestId, req.user.id]
  );
  if (!row) throw new AppError(404, 'Category unlock request not found');
  if (row.status !== 'pending') throw new AppError(400, `Request is already ${row.status}`);
  if (new Date(row.expires_at) < new Date()) {
    await db.query("UPDATE category_unlock_requests SET status='expired' WHERE id=?", [requestId]);
    throw new AppError(400, 'Unlock request has expired');
  }

  if (approve) {
    // 1. Verify 6-digit match code from laptop screen
    const inputCode = String(matchCode || '').replace(/\s+/g, '').trim();
    const expectedCode = String(row.security_code || '').replace(/\s+/g, '').trim();
    if (!inputCode) throw new AppError(400, 'Please enter the 6-digit Security Match Code shown on your laptop screen');
    if (inputCode !== expectedCode) throw new AppError(403, 'Incorrect Security Match Code. Check digits on laptop screen.');

    // 2. Double password confirmation
    const pw = String(password || '');
    const confirmPw = String(confirmPassword || '');
    if (!pw) throw new AppError(400, 'Please enter account or folder password');
    if (!confirmPw) throw new AppError(400, 'Please re-enter password for confirmation');
    if (pw !== confirmPw) throw new AppError(400, 'Passwords do not match. Please re-enter both accurately.');

    // 3. Verify against category PIN OR user password
    const cat = await ownedCat(req.user.id, row.category_id);
    if (!cat) throw new AppError(404, 'Category not found');

    const [[u]] = await db.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!u) throw new AppError(404, 'User not found');

    const catOk = cat.pin_hash ? await bcrypt.compare(pw, cat.pin_hash) : false;
    const userOk = await bcrypt.compare(pw, u.password_hash);
    if (!catOk && !userOk) {
      throw new AppError(403, 'Incorrect password. Folder unlock rejected.');
    }

    await db.query("UPDATE category_unlock_requests SET status='approved' WHERE id=?", [requestId]);
    await log(req.user.id, 'category_mobile_unlocked', `Unlocked folder #${cat.id} via mobile authorization`);
    return res.json({ ok: true, status: 'approved' });
  } else {
    await db.query("UPDATE category_unlock_requests SET status='rejected' WHERE id=?", [requestId]);
    await log(req.user.id, 'category_mobile_rejected', `Rejected folder unlock for category #${row.category_id}`);
    return res.json({ ok: true, status: 'rejected' });
  }
}));

module.exports = router;
