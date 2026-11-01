require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'vaultcloset'
  });

  console.log('Connected to MySQL. Checking users table schema...');
  const [cols] = await conn.query('DESCRIBE users');
  const hasUsername = cols.some((c) => c.Field === 'username');

  if (!hasUsername) {
    console.log('Adding username column to users table...');
    await conn.query('ALTER TABLE users ADD COLUMN username VARCHAR(50) NULL UNIQUE AFTER id');
    console.log('Column username added successfully.');
  } else {
    console.log('Column username already exists.');
  }

  // Also make email nullable so future users do not need an email at all
  const emailCol = cols.find((c) => c.Field === 'email');
  if (emailCol && emailCol.Null === 'NO') {
    console.log('Making email column NULLABLE...');
    await conn.query('ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NULL UNIQUE');
    console.log('Email column is now nullable.');
  }

  // For any existing user without a username, generate a clean username from email prefix or user_id
  const [users] = await conn.query('SELECT id, email, username FROM users WHERE username IS NULL');
  for (const u of users) {
    let base = (u.email ? u.email.split('@')[0] : `user${u.id}`).toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!base || base.length < 3) base = `user${u.id}`;
    let candidate = base;
    let suffix = 1;
    while (true) {
      const [existing] = await conn.query('SELECT id FROM users WHERE username=? AND id<>?', [candidate, u.id]);
      if (existing.length === 0) break;
      candidate = `${base}${suffix++}`;
    }
    await conn.query('UPDATE users SET username=? WHERE id=?', [candidate, u.id]);
    console.log(`Auto-assigned initial username '${candidate}' to existing user #${u.id} (${u.email})`);
  }

  console.log('Migration completed successfully.');
  await conn.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
