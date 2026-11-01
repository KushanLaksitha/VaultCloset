// Runs schema.sql against your MySQL server:  npm run db:init
require('dotenv').config();
const fs = require('fs'), path = require('path'), mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, multipleStatements: true });
  await c.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  console.log('Database ready.'); await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
