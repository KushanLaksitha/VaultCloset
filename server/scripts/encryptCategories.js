/**
 * Migration: Encrypt category names in categories table with user-bound AES-256-GCM.
 * Run: node scripts/encryptCategories.js
 */
require('dotenv').config();
const db = require('../config/db');
const { encryptCategory } = require('../services/encryptionService');

(async () => {
  try {
    console.log('--- Migrating Categories to User-Bound AES-256-GCM Encryption ---');

    // 1. Expand column length to VARCHAR(255) to fit AES-256-GCM ciphertext
    console.log('Modifying categories.name column to VARCHAR(255)...');
    await db.query('ALTER TABLE categories MODIFY COLUMN name VARCHAR(255) NOT NULL');
    console.log('Column modified successfully.');

    // 2. Fetch all existing categories
    const [rows] = await db.query('SELECT id, user_id, name FROM categories');
    console.log(`Found ${rows.length} category records.`);

    let encryptedCount = 0;
    for (const row of rows) {
      if (!row.name || row.name.startsWith('enc:v1:')) {
        continue;
      }
      const enc = encryptCategory(row.name, row.user_id);
      await db.query('UPDATE categories SET name=? WHERE id=?', [enc, row.id]);
      encryptedCount++;
    }

    console.log(`Successfully encrypted ${encryptedCount} existing category record(s).`);
    console.log('All categories are now protected at rest!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();
