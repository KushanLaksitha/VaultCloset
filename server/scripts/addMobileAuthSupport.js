/**
 * Migration: Add mobile_auth_enabled to users table and create desktop_login_requests table.
 * Run: node scripts/addMobileAuthSupport.js
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const db = require('../config/db');

async function run() {
  console.log('--- Migrating Mobile Auth Support ---');

  // 1. Add mobile_auth_enabled to users
  try {
    await db.query(`ALTER TABLE users ADD COLUMN mobile_auth_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Require mobile device authorization for desktop login"`);
    console.log('✅ Added column: users.mobile_auth_enabled');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('ℹ️  Column users.mobile_auth_enabled already exists');
    } else {
      throw e;
    }
  }

  // 2. Create desktop_login_requests table
  await db.query(`
    CREATE TABLE IF NOT EXISTS desktop_login_requests (
      id VARCHAR(64) PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      security_code VARCHAR(10) NOT NULL,
      status ENUM('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
      session_token TEXT NULL,
      device_info VARCHAR(255) NULL,
      ip_address VARCHAR(45) NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_dlr_user (user_id),
      KEY idx_dlr_status (status),
      CONSTRAINT fk_dlr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log('✅ Created or verified table: desktop_login_requests');

  console.log('--- Migration Completed Successfully ---');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

