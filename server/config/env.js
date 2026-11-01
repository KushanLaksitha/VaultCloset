require('dotenv').config();
const need = (k) => { if (!process.env[k]) throw new Error(`Missing env var ${k}`); return process.env[k]; };
const env = {
  prod: process.env.NODE_ENV === 'production',
  port: +process.env.PORT || 5000,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtSecret: need('JWT_SECRET'),
  masterKey: Buffer.from(need('MASTER_KEY'), 'hex'),
  vaultDir: process.env.VAULT_DIR || './storage/vault',
  tempDir: process.env.TEMP_DIR || './storage/tmp',
  pendingDir: process.env.PENDING_DIR || './storage/pending',
  maxFileMb: +process.env.MAX_FILE_MB || 15,
  rejectedTtlHours: +process.env.REJECTED_TTL_HOURS || 24,
  sessionHours: +process.env.SESSION_HOURS || 12,
};
if (!/^[0-9a-f]{64}$/i.test(process.env.MASTER_KEY)) throw new Error('MASTER_KEY must be 64 hex characters');
if (env.jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
module.exports = env;
