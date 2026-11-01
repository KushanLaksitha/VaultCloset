/**
 * Migration: Remove global shared categories (user_id=NULL) and replace them
 * with per-user clones so every user owns and fully controls their own categories.
 *
 * Steps:
 *  1. For each user, create private copies of the 4 default categories
 *     (Frocks, Shorts & T-Shirts, Trousers & Blouses, Other) - skipping if already owned.
 *  2. Reassign any images that were in global category slots to the user's own copy.
 *  3. Delete the global categories (user_id IS NULL).
 *  4. Remove the seed INSERT from schema.sql (conceptual note only - handled in code).
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../config/db');

const DEFAULT_CATS = [
  { name: 'Frocks',            sort_order: 1 },
  { name: 'Shorts & T-Shirts', sort_order: 2 },
  { name: 'Trousers & Blouses',sort_order: 3 },
  { name: 'Other',             sort_order: 4 },
];

async function run() {
  // 1. Get all existing global categories
  const [globals] = await db.query('SELECT * FROM categories WHERE user_id IS NULL');
  if (!globals.length) {
    console.log('No global categories found — migration already done or clean install.');
    process.exit(0);
  }
  console.log('Global categories found:', globals.map(c => `[${c.id}] ${c.name}`).join(', '));

  // 2. Get all users
  const [users] = await db.query('SELECT id, email FROM users');
  console.log(`Users: ${users.map(u => u.email).join(', ')}`);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (const user of users) {
      console.log(`\nProcessing user ${user.id} (${user.email})...`);

      // Get this user's existing categories (user-owned)
      const [existingCats] = await conn.query(
        'SELECT id, name FROM categories WHERE user_id=?', [user.id]
      );
      const existingNames = new Map(existingCats.map(c => [c.name.toLowerCase(), c.id]));

      // Build a map: global_cat_id -> user's owned cat_id
      const globalToUser = new Map();

      for (const globalCat of globals) {
        const lname = globalCat.name.toLowerCase();
        if (existingNames.has(lname)) {
          // User already has this category name — just map to it
          globalToUser.set(globalCat.id, existingNames.get(lname));
          console.log(`  "${globalCat.name}" already exists for user (id=${existingNames.get(lname)})`);
        } else {
          // Create a new user-owned copy
          const [r] = await conn.query(
            'INSERT INTO categories (user_id, name, is_default, sort_order) VALUES (?,?,1,?)',
            [user.id, globalCat.name, globalCat.sort_order]
          );
          globalToUser.set(globalCat.id, r.insertId);
          console.log(`  Created "${globalCat.name}" for user (new id=${r.insertId})`);
        }
      }

      // Reassign images from global categories to user's own categories
      for (const [globalId, userCatId] of globalToUser.entries()) {
        const [upd] = await conn.query(
          'UPDATE images SET category_id=? WHERE category_id=? AND user_id=?',
          [userCatId, globalId, user.id]
        );
        if (upd.affectedRows > 0) {
          console.log(`  Moved ${upd.affectedRows} image(s) from global cat ${globalId} → user cat ${userCatId}`);
        }
      }
    }

    // 3. Verify no images remain pointing to global categories
    const globalIds = globals.map(c => c.id);
    const [remaining] = await conn.query(
      `SELECT COUNT(*) n FROM images WHERE category_id IN (${globalIds.map(() => '?').join(',')})`,
      globalIds
    );
    if (remaining[0].n > 0) {
      throw new Error(`${remaining[0].n} images still reference global categories! Aborting.`);
    }

    // 4. Delete global categories
    await conn.query(
      `DELETE FROM categories WHERE user_id IS NULL`
    );
    console.log(`\nDeleted ${globals.length} global category(ies) from DB.`);

    await conn.commit();
    console.log('\n✅ Migration complete! All users now have personal categories.');
  } catch (e) {
    await conn.rollback();
    console.error('\n❌ Migration failed, rolled back:', e.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
