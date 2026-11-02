// Migration: add target_type to categories table and seed default video & document categories
require('dotenv').config();
const mysql = require('mysql2/promise');
const { encryptCategory } = require('../services/encryptionService');

async function run() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'vaultcloset',
    multipleStatements: true,
  });

  // 1. Check if target_type column exists
  const [cols] = await db.query("SHOW COLUMNS FROM categories LIKE 'target_type'");
  if (!cols.length) {
    console.log('Adding target_type column to categories...');
    await db.query(`
      ALTER TABLE categories
      ADD COLUMN target_type ENUM('image', 'video', 'document') NOT NULL DEFAULT 'image' AFTER user_id,
      ADD INDEX idx_cat_user_type (user_id, target_type)
    `);
    console.log('target_type column added.');
  } else {
    console.log('target_type column already exists.');
  }

  // 2. Default categories for each type
  const videoDefaults = [
    ['Movies', 1],
    ['Clips', 2],
    ['Personal Videos', 3],
    ['Other Videos', 4],
  ];

  const docDefaults = [
    ['Personal Documents', 1],
    ['Work & Projects', 2],
    ['Financial & Bills', 3],
    ['Other Documents', 4],
  ];

  // 3. For all users in users table, ensure they have video & document default categories
  const [users] = await db.query('SELECT id, username FROM users');
  console.log(`Checking categories for ${users.length} user(s)...`);

  for (const u of users) {
    // Check if user has video categories
    const [vidCats] = await db.query(
      "SELECT id FROM categories WHERE user_id=? AND target_type='video'",
      [u.id]
    );
    if (!vidCats.length) {
      console.log(`Seeding default video categories for user @${u.username} (ID: ${u.id})...`);
      for (const [name, sort] of videoDefaults) {
        const encName = encryptCategory(name, u.id);
        await db.query(
          "INSERT INTO categories (user_id, target_type, name, is_default, sort_order) VALUES (?, 'video', ?, 1, ?)",
          [u.id, encName, sort]
        );
      }
    }

    // Check if user has document categories
    const [docCats] = await db.query(
      "SELECT id FROM categories WHERE user_id=? AND target_type='document'",
      [u.id]
    );
    if (!docCats.length) {
      console.log(`Seeding default document categories for user @${u.username} (ID: ${u.id})...`);
      for (const [name, sort] of docDefaults) {
        const encName = encryptCategory(name, u.id);
        await db.query(
          "INSERT INTO categories (user_id, target_type, name, is_default, sort_order) VALUES (?, 'document', ?, 1, ?)",
          [u.id, encName, sort]
        );
      }
    }
  }

  // 4. Update any existing records in vault_files if their category is currently an 'image' category
  const [vaultFiles] = await db.query(
    `SELECT vf.id, vf.user_id, vf.file_type, c.target_type AS cat_target_type
     FROM vault_files vf
     JOIN categories c ON c.id=vf.category_id
     WHERE c.target_type = 'image'`
  );

  if (vaultFiles.length) {
    console.log(`Migrating ${vaultFiles.length} file(s) currently linked to image categories...`);
    for (const file of vaultFiles) {
      // Find user's default category matching file.file_type ('video' or 'document')
      const targetType = file.file_type === 'video' ? 'video' : 'document';
      const [matchingCats] = await db.query(
        'SELECT id FROM categories WHERE user_id=? AND target_type=? ORDER BY is_default DESC, id ASC LIMIT 1',
        [file.user_id, targetType]
      );
      if (matchingCats.length) {
        await db.query('UPDATE vault_files SET category_id=? WHERE id=?', [
          matchingCats[0].id,
          file.id,
        ]);
      }
    }
    console.log('Vault files migration complete.');
  }

  console.log('Migration finished successfully!');
  await db.end();
}

run().catch((e) => {
  console.error('Migration error:', e);
  process.exit(1);
});
