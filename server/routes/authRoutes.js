const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const env = require('../config/env');
const requireAuth = require('../middleware/authMiddleware');
const { signSession } = require('../utils/tokens');
const { AppError, wrap } = require('../utils/errors');
const { log } = require('../services/imageService');
const { encryptCategory } = require('../services/encryptionService');

const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: env.prod, maxAge: env.sessionHours * 3600e3 };
const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.display_name, email: u.email });

function validateUsername(val) {
  const u = String(val || '').trim().toLowerCase();
  if (!u) throw new AppError(400, 'Please enter a username');
  if (u.includes('@')) throw new AppError(400, 'Username cannot be an email address');
  if (!/^[a-z0-9_]{3,30}$/.test(u)) {
    throw new AppError(400, 'Username must be 3–30 characters long and contain only letters, numbers, and underscores');
  }
  return u;
}

// Pre-computed dummy hash to prevent timing attacks / user enumeration
const DUMMY_HASH = '$2a$12$K1rOaZz0hJp2b6y3k7uW4uO0aO0aO0aO0aO0aO0aO0aO0aO0aO0aO';

// In-memory lockout tracker for brute force / credential stuffing protection
const loginAttempts = new Map(); // key: `${ip}_${identifier}` -> { count: number, lockedUntil: number }
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout

const COMMON_PASSWORDS = new Set([
  'password123', '1234567890', 'qwertyuiop', 'admin12345', 'iloveyou123',
  'password1234', 'welcome123', 'secret1234', 'monkey1234', 'dragon1234',
  'master1234', 'testing123', 'shadow1234', 'football123'
]);

router.post('/register', wrap(async (req, res) => {
  const username = validateUsername(req.body.username);
  const name = String(req.body.displayName || '').trim().slice(0, 100);
  const pw = String(req.body.password || '');

  if (!name) throw new AppError(400, 'Enter your display name');
  if (pw.length < 10) throw new AppError(400, 'Password must be at least 10 characters long');
  if (COMMON_PASSWORDS.has(pw.toLowerCase())) {
    throw new AppError(400, 'This password is too common and easily guessed. Please pick a stronger password.');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z0-9!@#$%^&*])/.test(pw)) {
    throw new AppError(400, 'Password must include a mix of uppercase/numbers/symbols and lowercase letters');
  }

  // Check unique username
  const [[existing]] = await db.query('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (existing) throw new AppError(409, 'This username is already taken. Please choose another.');

  const hash = await bcrypt.hash(pw, 12);
  const [r] = await db.query(
    'INSERT INTO users (username, display_name, password_hash) VALUES (?,?,?)',
    [username, name, hash]
  ).catch((e) => {
    throw e.code === 'ER_DUP_ENTRY' ? new AppError(409, 'This username is already taken') : e;
  });
  const uid = r.insertId;

  // Seed default categories for the new user (fully owned — can rename/delete freely)
  const defaults = [
    ['Frocks', 1],
    ['Shorts & T-Shirts', 2],
    ['Trousers & Blouses', 3],
    ['Other', 4],
  ];
  for (const [catName, sortOrder] of defaults) {
    const encName = encryptCategory(catName, uid);
    await db.query(
      'INSERT IGNORE INTO categories (user_id, name, is_default, sort_order) VALUES (?,?,1,?)',
      [uid, encName, sortOrder]
    ).catch(() => {});
  }

  await log(uid, 'account_registered', `Account registered with username @${username} from ${req.ip || 'unknown'}`);
  res.cookie('vc_session', signSession(uid), cookieOpts).status(201).json({
    user: { id: uid, username, displayName: name, email: null }
  });
}));


router.post('/login', wrap(async (req, res) => {
  const identifier = String(req.body.username || req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const lockKey = `${ip}_${identifier}`;

  if (!identifier) throw new AppError(400, 'Please enter your username');
  if (!password) throw new AppError(400, 'Please enter your password');

  const now = Date.now();
  const attemptState = loginAttempts.get(lockKey) || { count: 0, lockedUntil: 0 };

  // Check if account/IP is locked out
  if (attemptState.lockedUntil > now) {
    const minsLeft = Math.ceil((attemptState.lockedUntil - now) / 60000);
    throw new AppError(429, `Too many failed login attempts. Temporarily locked for security. Please try again in ${minsLeft} minute(s).`, 'ACCOUNT_LOCKED');
  }

  // Support both username (primary) and legacy email (fallback for existing accounts)
  const [[u]] = await db.query(
    'SELECT * FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?) LIMIT 1',
    [identifier, identifier]
  );

  // Constant-time comparison: Always execute bcrypt.compare even if user does not exist
  const hashToCompare = u ? u.password_hash : DUMMY_HASH;
  const ok = await bcrypt.compare(password, hashToCompare);

  if (!u || !ok) {
    const newCount = attemptState.count + 1;
    if (newCount >= MAX_FAILED_ATTEMPTS) {
      loginAttempts.set(lockKey, { count: newCount, lockedUntil: now + LOCKOUT_MS });
      if (u) await log(u.id, 'security_alert', `Account locked after ${MAX_FAILED_ATTEMPTS} failed attempts from IP ${ip}`);
      throw new AppError(429, `Too many failed login attempts. This account is locked for 15 minutes to prevent unauthorized access.`, 'ACCOUNT_LOCKED');
    }

    loginAttempts.set(lockKey, { count: newCount, lockedUntil: 0 });
    const remaining = MAX_FAILED_ATTEMPTS - newCount;
    if (u) await log(u.id, 'failed_login', `Failed login attempt from IP ${ip} (${remaining} attempts remaining)`);
    throw new AppError(401, `Username or password is incorrect. (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before security lockout)`);
  }

  // Clear failed attempt tracking on successful login
  loginAttempts.delete(lockKey);
  await log(u.id, 'login', `Signed in successfully as @${u.username} from IP ${ip}`);
  res.cookie('vc_session', signSession(u.id), cookieOpts).json({ user: publicUser(u) });
}));


router.post('/logout', (_req, res) => res.clearCookie('vc_session', { ...cookieOpts, maxAge: undefined }).json({ ok: true }));


router.get('/me', requireAuth, wrap(async (req, res) => {
  const [[u]] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  if (!u) throw new AppError(401, 'Please sign in again');
  res.json({ user: publicUser(u) });
}));


// Change account password (requires current password)
router.post('/change-password', requireAuth, wrap(async (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!currentPassword) throw new AppError(400, 'Enter your current password');
  if (!newPassword) throw new AppError(400, 'Enter your new password');
  if (newPassword.length < 10) throw new AppError(400, 'New password must be at least 10 characters long');
  if (COMMON_PASSWORDS.has(newPassword.toLowerCase())) {
    throw new AppError(400, 'This password is too common and easily guessed. Please choose a stronger password.');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z0-9!@#$%^&*])/.test(newPassword)) {
    throw new AppError(400, 'New password must include a mix of uppercase/numbers/symbols and lowercase letters');
  }

  const [[u]] = await db.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!u) throw new AppError(401, 'User not found');

  const ok = await bcrypt.compare(currentPassword, u.password_hash);
  if (!ok) throw new AppError(403, 'Current password is incorrect');

  if (currentPassword === newPassword) {
    throw new AppError(400, 'New password must be different from current password');
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.query('UPDATE users SET password_hash=? WHERE id=?', [newHash, req.user.id]);
  await log(req.user.id, 'password_changed', 'Account password was updated');

  res.json({ ok: true, message: 'Password changed successfully' });
}));


// Set or update username
router.post('/username', requireAuth, wrap(async (req, res) => {
  const newUsername = validateUsername(req.body.username);

  // Check if taken by another user
  const [[existing]] = await db.query(
    'SELECT id FROM users WHERE LOWER(username)=LOWER(?) AND id<>?',
    [newUsername, req.user.id]
  );
  if (existing) throw new AppError(409, 'This username is already taken. Please choose another.');

  await db.query('UPDATE users SET username=? WHERE id=?', [newUsername, req.user.id]);
  await log(req.user.id, 'username_changed', `Username changed to @${newUsername}`);

  const [[updated]] = await db.query('SELECT * FROM users WHERE id=?', [req.user.id]);
  res.json({ ok: true, user: publicUser(updated) });
}));

module.exports = router;

