import 'dotenv/config';
/**
 * One-off script to create or update an admin login for the admin panel.
 * There's no signup UI - this is how you provision access. Run against a
 * real DATABASE_URL (see Task 11 for the production credentials).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/create-admin.ts <username> <password>
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { admins } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/adminPassword.js';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: tsx scripts/create-admin.ts <username> <password>');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const { hash, salt } = hashPassword(password);
  const existing = await db.select().from(admins).where(eq(admins.username, username)).limit(1);

  if (existing[0]) {
    await db
      .update(admins)
      .set({ passwordHash: hash, passwordSalt: salt })
      .where(eq(admins.id, existing[0].id));
    console.log(`Updated password for admin "${username}".`);
  } else {
    await db.insert(admins).values({ username, passwordHash: hash, passwordSalt: salt });
    console.log(`Created admin "${username}".`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
