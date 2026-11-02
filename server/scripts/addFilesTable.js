// Migration: create vault_files table for encrypted video/document storage
require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'vaultcloset',
    multipleStatements: true,
  });

  await db.execute(`
    CREATE TABLE IF NOT EXISTS vault_files (
      id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id       BIGINT UNSIGNED NOT NULL,
      category_id   BIGINT UNSIGNED NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      enc_file_ref  VARCHAR(255) NOT NULL,
      wrapped_key   TEXT NOT NULL,
      content_hash  CHAR(64) NOT NULL,
      mime_type     VARCHAR(120) NOT NULL,
      file_type     ENUM('video','document') NOT NULL,
      file_size     BIGINT UNSIGNED NOT NULL,
      is_favorite   TINYINT(1) NOT NULL DEFAULT 0,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY           idx_vf_user (user_id, created_at),
      KEY           idx_vf_cat  (user_id, category_id),
      UNIQUE KEY    uq_vf_hash  (user_id, content_hash),
      CONSTRAINT fk_vf_user FOREIGN KEY (user_id)     REFERENCES users(id)      ON DELETE CASCADE,
      CONSTRAINT fk_vf_cat  FOREIGN KEY (category_id) REFERENCES categories(id)
    ) ENGINE=InnoDB
  `);

  console.log('vault_files table created (or already exists)');
  await db.end();
}

run().catch((e) => { console.error(e.message); process.exit(1); });

