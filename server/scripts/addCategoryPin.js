/**
 * Migration: add pin_hash column to categories table.
 * Run: node scripts/addCategoryPin.js
 */
require('dotenv').config();
const db = require('../config/db');
async function addCol(col, def) {
  try {
    await db.query(`ALTER TABLE categories ADD COLUMN ${col} ${def}`);
    console.log(`  ✅ Added: ${col}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log(`  ℹ️  Already exists: ${col}`);
    else throw e;
  }
}
(async () => {
  try {
    await addCol('pin_hash', 'VARCHAR(255) NULL DEFAULT NULL COMMENT "bcrypt hash of optional category PIN"');
    console.log('Migration complete.');
  } catch (e) { console.error('Failed:', e.message); process.exit(1); }
  finally { process.exit(0); }
})();
