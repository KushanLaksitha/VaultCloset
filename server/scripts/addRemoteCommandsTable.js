require('dotenv').config({ path: __dirname + '/../.env' });
const db = require('../config/db');

async function migrate() {
  console.log('Running migration: create remote_security_commands table...');
  await db.query(`
    CREATE TABLE IF NOT EXISTS remote_security_commands (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      target_device VARCHAR(50) DEFAULT 'desktop',
      command VARCHAR(50) NOT NULL,
      executed_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_cmd (user_id, executed_at, created_at)
    )
  `);
  console.log('Migration completed: remote_security_commands table is ready!');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
