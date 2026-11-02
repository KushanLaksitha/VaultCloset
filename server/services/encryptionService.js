/**
 * Envelope encryption with AES-256-GCM.
 *  - Every image gets its own random 32-byte key (DEK).
 *  - The DEK is encrypted ("wrapped") with MASTER_KEY from the environment; only the wrapped
 *    form is stored in MySQL. Without MASTER_KEY the files cannot be opened.
 *  - File layout on disk: [12-byte IV][16-byte auth tag][ciphertext]. The GCM tag detects tampering.
 *  - User Category Encryption: Each user has an isolated, user-bound key derived via HMAC-SHA256
 *    with MASTER_KEY. Category names in MySQL are stored as AES-256-GCM encrypted ciphertexts,
 *    preventing category enumeration even if an attacker has the username or direct database access.
 */
const crypto = require('crypto');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

function seal(plain, key) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

function open(blob, key) {
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
  } catch {
    throw new AppError(500, 'Could not decrypt file (wrong key or corrupted data)', 'DECRYPT');
  }
}

function newVault() {
  const dek = crypto.randomBytes(32);
  return { wrappedKey: seal(dek, env.masterKey).toString('base64'), encrypt: (b) => seal(b, dek) };
}

function openVault(wrappedKey) {
  const dek = open(Buffer.from(wrappedKey, 'base64'), env.masterKey);
  return { decrypt: (b) => open(b, dek) };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Derives a unique 32-byte key for encrypting a specific user's categories
function getUserCategoryKey(userId) {
  return crypto.createHmac('sha256', env.masterKey).update(`user_cat_${userId}`).digest();
}

/**
 * Encrypt a category name for a given user.
 * Stored as: enc:v1:<base64-sealed-data>
 */
function encryptCategory(name, userId) {
  if (!name) return name;
  const str = String(name).trim();
  if (str.startsWith('enc:v1:')) return str; // already encrypted
  const key = getUserCategoryKey(userId);
  const sealed = seal(Buffer.from(str, 'utf8'), key);
  return 'enc:v1:' + sealed.toString('base64');
}

/**
 * Decrypt a category name for a given user.
 * If not encrypted (legacy plain text), returns as-is.
 */
function decryptCategory(val, userId) {
  if (!val) return val;
  const str = String(val);
  if (!str.startsWith('enc:v1:')) return str; // legacy plain text fallback
  try {
    const key = getUserCategoryKey(userId);
    const blob = Buffer.from(str.slice(7), 'base64');
    const plain = open(blob, key);
    return plain.toString('utf8');
  } catch {
    return '[Protected Category]';
  }
}

module.exports = {
  newVault,
  openVault,
  sha256,
  getUserCategoryKey,
  encryptCategory,
  decryptCategory,
};
