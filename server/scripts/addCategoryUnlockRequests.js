/**
 * Migration: Create category_unlock_requests table for mobile authorization of protected categories.
 * Run: node scripts/addCategoryUnlockRequests.js
 */
require('dotenv').config({ path: __dirname + '/../.env' });
const db = require('../config/db');

async function run() {
  console.log('--- Migrating Category Unlock Requests ---');

  await db.query(`
    CREATE TABLE IF NOT EXISTS category_unlock_requests (
      id VARCHAR(64) PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      category_id BIGINT UNSIGNED NOT NULL,
      security_code VARCHAR(10) NOT NULL,
      status ENUM('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
      device_info VARCHAR(255) NULL,
      ip_address VARCHAR(45) NULL,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_cur_user (user_id),
      KEY idx_cur_status (status),
      CONSTRAINT fk_cur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_cur_cat FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('✅ Created or verified table: category_unlock_requests');
  console.log('--- Migration Complete ---');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

