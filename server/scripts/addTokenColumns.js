/**
 * One-time migration: add token-usage columns to ai_analysis.
 * Run once: node scripts/addTokenColumns.js
 */
require('dotenv').config();
const db = require('../config/db');
async function addCol(col, def) {
  try {
    await db.query(`ALTER TABLE ai_analysis ADD COLUMN ${col} ${def}`);
    console.log(`  ✅ Added column: ${col}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log(`  ℹ️  Column already exists: ${col}`);
    else throw e;
  }
}
(async () => {
  try {
    await addCol('input_tokens', 'INT UNSIGNED NULL');
    await addCol('output_tokens', 'INT UNSIGNED NULL');
    console.log('Migration complete.');
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
})();

