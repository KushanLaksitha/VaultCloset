const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const env = require('../config/env');
const requireAuth = require('../middleware/authMiddleware');
const { signSession } = require('../utils/tokens');
const { AppError, wrap } = require('../utils/errors');
const { log } = require('../services/imageService');
const { encryptCategory } = require('../services/encryptionService');

const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: env.prod, maxAge: env.sessionHours * 3600e3 };
const publicUser = (u) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  email: u.email,
  mobileAuthEnabled: Boolean(u.mobile_auth_enabled),
});

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

function isMobileUserAgent(ua, explicitMobileFlag) {
  if (explicitMobileFlag === true) return true;
  if (explicitMobileFlag === false) return false;
  if (!ua) return false;
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

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

  // Seed default categories for the new user (Photos, Videos, and Documents)
  const imageDefaults = [
    ['Frocks', 1],
    ['Shorts & T-Shirts', 2],
    ['Trousers & Blouses', 3],
    ['Other', 4],
  ];
  for (const [catName, sortOrder] of imageDefaults) {
    const encName = encryptCategory(catName, uid);
    await db.query(
      "INSERT INTO categories (user_id, target_type, name, is_default, sort_order) VALUES (?,'image',?,1,?)",
      [uid, encName, sortOrder]
    ).catch(() => {});
  }

  const videoDefaults = [
    ['Movies', 1],
    ['Clips', 2],
    ['Personal Videos', 3],
    ['Other Videos', 4],
  ];
  for (const [catName, sortOrder] of videoDefaults) {
    const encName = encryptCategory(catName, uid);
    await db.query(
      "INSERT INTO categories (user_id, target_type, name, is_default, sort_order) VALUES (?,'video',?,1,?)",
      [uid, encName, sortOrder]
    ).catch(() => {});
  }

  const docDefaults = [
    ['Personal Documents', 1],
    ['Work & Projects', 2],
    ['Financial & Bills', 3],
    ['Other Documents', 4],
  ];
  for (const [catName, sortOrder] of docDefaults) {
    const encName = encryptCategory(catName, uid);
    await db.query(
      "INSERT INTO categories (user_id, target_type, name, is_default, sort_order) VALUES (?,'document',?,1,?)",
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

  // Check if mobile authorization is required for desktop/laptop sign-in
  const isMobile = isMobileUserAgent(req.headers['user-agent'], req.body.isMobile);
  if (Boolean(u.mobile_auth_enabled) && !isMobile) {
    // Invalidate prior pending requests for this user
    await db.query("UPDATE desktop_login_requests SET status='expired' WHERE user_id=? AND status='pending'", [u.id]);

    const requestId = crypto.randomUUID();
    const rawCode = String(crypto.randomInt(100000, 999999));
    const securityCode = `${rawCode.slice(0, 3)} ${rawCode.slice(3)}`;
    const deviceInfo = getDeviceInfo(req.headers['user-agent']);
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes

    await db.query(
      `INSERT INTO desktop_login_requests (id, user_id, security_code, status, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      [requestId, u.id, securityCode, deviceInfo, ip, expiresAt]
    );

    await log(u.id, 'mobile_auth_requested', `Desktop sign-in paused for mobile approval from IP ${ip} (Code: ${securityCode}, Device: ${deviceInfo})`);

    return res.json({
      requireMobileAuth: true,
      loginRequestId: requestId,
      securityCode,
      deviceInfo,
      expiresIn: 180,
      username: u.username,
      displayName: u.display_name,
    });
  }

  await log(u.id, 'login', `Signed in successfully as @${u.username} from IP ${ip}`);
  res.cookie('vc_session', signSession(u.id), cookieOpts).json({ user: publicUser(u) });
}));


// Poll status of desktop login request
router.get('/login-request/:id/status', wrap(async (req, res) => {
  const { id } = req.params;
  const [[row]] = await db.query('SELECT * FROM desktop_login_requests WHERE id=?', [id]);
  if (!row) {
    return res.json({ status: 'not_found' });
  }

  const now = new Date();
  if (new Date(row.expires_at) < now && row.status === 'pending') {
    await db.query("UPDATE desktop_login_requests SET status='expired' WHERE id=?", [id]);
    return res.json({ status: 'expired' });
  }

  if (row.status === 'approved') {
    if (row.session_token) {
      const [[u]] = await db.query('SELECT * FROM users WHERE id=?', [row.user_id]);
      if (!u) throw new AppError(404, 'User not found');

      // Set session cookie on the desktop browser
      res.cookie('vc_session', row.session_token, cookieOpts);

      // Invalidate the session_token so it cannot be fetched again
      await db.query("UPDATE desktop_login_requests SET session_token=NULL WHERE id=?", [id]);
      await log(u.id, 'mobile_auth_completed', `Desktop login completed successfully via mobile authorization`);

      return res.json({
        status: 'approved',
        user: publicUser(u),
      });
    }
    return res.json({ status: 'approved' });
  }

  const remainingSeconds = Math.max(0, Math.round((new Date(row.expires_at) - now) / 1000));
  return res.json({
    status: row.status,
    remainingSeconds,
    securityCode: row.security_code,
  });
}));


// Cancel a pending login request
router.post('/login-request/:id/cancel', wrap(async (req, res) => {
  const { id } = req.params;
  await db.query("UPDATE desktop_login_requests SET status='expired' WHERE id=? AND status='pending'", [id]);
  res.json({ ok: true });
}));


// Check for pending desktop login requests (Mobile user polling)
router.get('/mobile-auth/pending', requireAuth, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, device_info, ip_address, expires_at, created_at
     FROM desktop_login_requests
     WHERE user_id=? AND status='pending' AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [req.user.id]
  );
  res.json({ pendingRequest: rows[0] || null });
}));


// Approve or reject desktop login request from mobile app (requires match code and double password verification)
router.post('/mobile-auth/respond', requireAuth, wrap(async (req, res) => {
  const { requestId, approve, matchCode, password, confirmPassword } = req.body;
  if (!requestId) throw new AppError(400, 'Missing requestId');

  const [[row]] = await db.query(
    'SELECT * FROM desktop_login_requests WHERE id=? AND user_id=?',
    [requestId, req.user.id]
  );

  if (!row) throw new AppError(404, 'Login request not found');
  if (row.status !== 'pending') throw new AppError(400, `Request is already ${row.status}`);
  if (new Date(row.expires_at) < new Date()) {
    await db.query("UPDATE desktop_login_requests SET status='expired' WHERE id=?", [requestId]);
    throw new AppError(400, 'Login request has expired');
  }

  if (approve) {
    // 1. Verify 6-digit Security Match Code from laptop screen
    const inputCode = String(matchCode || '').replace(/\s+/g, '').trim();
    const expectedCode = String(row.security_code || '').replace(/\s+/g, '').trim();
    if (!inputCode) {
      throw new AppError(400, 'Please enter the 6-digit Security Match Code shown on your laptop screen');
    }
    if (inputCode !== expectedCode) {
      throw new AppError(403, 'Incorrect Security Match Code. Please enter the exact digits displayed on your laptop.');
    }

    // 2. Verify Double Password Confirmation
    const pw = String(password || '');
    const confirmPw = String(confirmPassword || '');
    if (!pw) throw new AppError(400, 'Please enter your account password');
    if (!confirmPw) throw new AppError(400, 'Please re-enter your account password for confirmation');
    if (pw !== confirmPw) throw new AppError(400, 'Passwords do not match. Please re-enter both correctly.');

    const [[u]] = await db.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!u) throw new AppError(404, 'User not found');

    const ok = await bcrypt.compare(pw, u.password_hash);
    if (!ok) throw new AppError(403, 'Incorrect password. Laptop authorization rejected.');

    const sessionToken = signSession(req.user.id);
    await db.query(
      "UPDATE desktop_login_requests SET status='approved', session_token=? WHERE id=?",
      [sessionToken, requestId]
    );
    await log(req.user.id, 'mobile_auth_approved', `Approved desktop session from device ${row.device_info || 'Unknown'} with Match Code and double password confirmation`);
    return res.json({ ok: true, status: 'approved' });
  } else {
    await db.query("UPDATE desktop_login_requests SET status='rejected' WHERE id=?", [requestId]);
    await log(req.user.id, 'mobile_auth_rejected', `Denied desktop session from device ${row.device_info || 'Unknown'}`);
    return res.json({ ok: true, status: 'rejected' });
  }
}));


// Get public info for QR unlock screen
router.get('/mobile-auth/request-details/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const [[row]] = await db.query(
    `SELECT dlr.id, dlr.device_info, dlr.ip_address, dlr.status, dlr.expires_at,
            u.username, u.display_name
     FROM desktop_login_requests dlr
     JOIN users u ON u.id = dlr.user_id
     WHERE dlr.id = ?`,
    [id]
  );
  if (!row) throw new AppError(404, 'Login request not found');

  const expired = new Date(row.expires_at) < new Date();
  if (expired && row.status === 'pending') {
    await db.query("UPDATE desktop_login_requests SET status='expired' WHERE id=?", [id]);
    row.status = 'expired';
  }

  res.json({
    id: row.id,
    deviceInfo: row.device_info,
    ipAddress: row.ip_address,
    status: row.status,
    username: row.username,
    displayName: row.display_name,
    expiresAt: row.expires_at,
  });
}));


// Direct QR code unlock from mobile (requires match code and double password verification)
router.post('/mobile-auth/direct-unlock', wrap(async (req, res) => {
  const { requestId, matchCode, password, confirmPassword, approve } = req.body;
  if (!requestId) throw new AppError(400, 'Missing requestId');

  const [[row]] = await db.query('SELECT * FROM desktop_login_requests WHERE id=?', [requestId]);
  if (!row) throw new AppError(404, 'Login request not found');
  if (row.status !== 'pending' || new Date(row.expires_at) < new Date()) {
    throw new AppError(400, 'This login request has already expired or been completed');
  }

  const [[u]] = await db.query('SELECT * FROM users WHERE id=?', [row.user_id]);
  if (!u) throw new AppError(404, 'User not found');

  if (approve) {
    // 1. Verify 6-digit Security Match Code from laptop screen
    const inputCode = String(matchCode || '').replace(/\s+/g, '').trim();
    const expectedCode = String(row.security_code || '').replace(/\s+/g, '').trim();
    if (!inputCode) {
      throw new AppError(400, 'Please enter the 6-digit Security Match Code shown on your laptop screen');
    }
    if (inputCode !== expectedCode) {
      throw new AppError(403, 'Incorrect Security Match Code. Please enter the exact digits displayed on your laptop.');
    }

    // 2. Verify Double Password Confirmation
    const pw = String(password || '');
    const confirmPw = String(confirmPassword || '');
    if (!pw) throw new AppError(400, 'Please enter your account password');
    if (!confirmPw) throw new AppError(400, 'Please re-enter your account password for confirmation');
    if (pw !== confirmPw) throw new AppError(400, 'Passwords do not match. Please re-enter both correctly.');

    const ok = await bcrypt.compare(pw, u.password_hash);
    if (!ok) throw new AppError(403, 'Incorrect password. Laptop authorization rejected.');

    const sessionToken = signSession(u.id);
    await db.query(
      "UPDATE desktop_login_requests SET status='approved', session_token=? WHERE id=?",
      [sessionToken, requestId]
    );
    await log(u.id, 'mobile_auth_approved', `Approved desktop session via mobile QR unlock with Match Code and double password confirmation`);

    // Also sign in this mobile device so user is ready
    res.cookie('vc_session', sessionToken, cookieOpts).json({
      ok: true,
      status: 'approved',
      user: publicUser(u),
    });
  } else {
    await db.query("UPDATE desktop_login_requests SET status='rejected' WHERE id=?", [requestId]);
    await log(u.id, 'mobile_auth_rejected', `Denied desktop session via mobile QR unlock`);
    res.json({ ok: true, status: 'rejected' });
  }
}));


// Remote lock command via requestId (Public endpoint for scanned QR pages)
router.post('/remote-lock-by-request', wrap(async (req, res) => {
  const { requestId, action = 'lock_categories', type = 'category' } = req.body;
  if (!requestId) throw new AppError(400, 'Missing requestId');

  let userId = null;
  if (type === 'category') {
    const [[row]] = await db.query('SELECT user_id FROM category_unlock_requests WHERE id=?', [requestId]);
    userId = row ? row.user_id : null;
  } else {
    const [[row]] = await db.query('SELECT user_id FROM desktop_login_requests WHERE id=?', [requestId]);
    userId = row ? row.user_id : null;
  }

  if (!userId) throw new AppError(404, 'Request not found');

  const validActions = ['lock_categories', 'lock_vault', 'logout'];
  const cmd = validActions.includes(action) ? action : 'lock_categories';

  await db.query(
    'INSERT INTO remote_security_commands (user_id, target_device, command) VALUES (?, ?, ?)',
    [userId, 'desktop', cmd]
  );
  await db.query("UPDATE category_unlock_requests SET status='expired' WHERE user_id=? AND status='pending'", [userId]);
  await log(userId, 'remote_security_command', `Remote ${cmd} triggered via mobile QR link`);

  res.json({ ok: true, action: cmd });
}));


// Toggle Mobile Auth Requirement (Requires account password confirmation)
router.post('/mobile-auth/toggle', requireAuth, wrap(async (req, res) => {
  const { enabled, password } = req.body;
  const [[u]] = await db.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!u) throw new AppError(401, 'User not found');

  const ok = await bcrypt.compare(String(password || ''), u.password_hash);
  if (!ok) throw new AppError(403, 'Current password is required to change security settings');

  const newStatus = enabled ? 1 : 0;
  await db.query('UPDATE users SET mobile_auth_enabled=? WHERE id=?', [newStatus, req.user.id]);
  await log(req.user.id, 'security_setting_changed', `Mobile unlock requirement set to ${newStatus ? 'ENABLED' : 'DISABLED'}`);

  res.json({ ok: true, mobileAuthEnabled: Boolean(newStatus) });
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


// ── Remote Security Control Endpoints ────────────────────────────────────────

// Dispatch remote security action (called from mobile phone)
router.post('/remote-lock', requireAuth, wrap(async (req, res) => {
  const { action = 'lock_categories' } = req.body;
  const validActions = ['lock_categories', 'lock_vault', 'logout'];
  if (!validActions.includes(action)) {
    throw new AppError(400, `Invalid action. Must be one of: ${validActions.join(', ')}`);
  }

  await db.query(
    'INSERT INTO remote_security_commands (user_id, target_device, command) VALUES (?, ?, ?)',
    [req.user.id, 'desktop', action]
  );

  // If locking categories or vault, expire any pending category unlock requests
  if (action === 'lock_categories' || action === 'lock_vault') {
    await db.query(
      "UPDATE category_unlock_requests SET status='expired' WHERE user_id=? AND status='pending'",
      [req.user.id]
    );
  }

  await log(req.user.id, 'remote_command_sent', `Mobile dispatched remote command: ${action}`);

  res.json({ ok: true, action, message: `Remote command '${action}' sent to laptop` });
}));


// Security heartbeat poll (called by laptop/desktop to receive remote commands)
router.get('/security-heartbeat', requireAuth, wrap(async (req, res) => {
  const [rows] = await db.query(
    `SELECT id, command, created_at FROM remote_security_commands
     WHERE user_id=? AND executed_at IS NULL AND created_at >= NOW() - INTERVAL 1 MINUTE
     ORDER BY id ASC LIMIT 1`,
    [req.user.id]
  );

  if (rows.length === 0) {
    return res.json({ command: null });
  }

  const cmd = rows[0];
  await db.query('UPDATE remote_security_commands SET executed_at=NOW() WHERE id=?', [cmd.id]);

  res.json({
    command: cmd.command,
    timestamp: cmd.created_at,
  });
}));

module.exports = router;

