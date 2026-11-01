/**
 * Creates pending_images table for holding encrypted images when AI quota/limits are reached.
 */
require('dotenv').config();
const db = require('../config/db');

async function migrate() {
  const sql = `
    CREATE TABLE IF NOT EXISTS pending_images (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      enc_file_ref VARCHAR(255) NOT NULL,
      enc_thumb_ref VARCHAR(255) NOT NULL,
      wrapped_key TEXT NOT NULL,
      content_hash CHAR(64) NOT NULL,
      mime_type VARCHAR(50) NOT NULL,
      file_size BIGINT UNSIGNED NOT NULL,
      width INT UNSIGNED,
      height INT UNSIGNED,
      status ENUM('pending', 'failed') NOT NULL DEFAULT 'pending',
      fail_reason VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_pend_user (user_id),
      KEY idx_pend_hash (user_id, content_hash),
      CONSTRAINT fk_pend_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `;

  await db.query(sql);
  console.log('✅ pending_images table is ready.');
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
