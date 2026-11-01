/**
 * Envelope encryption with AES-256-GCM.
 *  - Every image gets its own random 32-byte key (DEK).
 *  - The DEK is encrypted ("wrapped") with MASTER_KEY from the environment; only the wrapped
 *    form is stored in MySQL. Without MASTER_KEY the files cannot be opened.
 *  - File layout on disk: [12-byte IV][16-byte auth tag][ciphertext]. The GCM tag detects tampering.
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
  } catch { throw new AppError(500, 'Could not decrypt file (wrong key or corrupted data)', 'DECRYPT'); }
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
module.exports = { newVault, openVault, sha256 };
