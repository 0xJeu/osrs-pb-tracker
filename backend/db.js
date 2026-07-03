const path = require('path');
const { createClient } = require('@libsql/client');

// If TURSO_DATABASE_URL is set (production, on Render), connect to the
// hosted Turso database. Otherwise fall back to a local SQLite file so this
// still works unchanged for local development on your own machine.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'data.db')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = createClient({ url, authToken });

async function init() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_hash TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      display_name_lower TEXT NOT NULL,
      install_secret_hash TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  // Pre-existing databases (created before install_secret_hash existed) need
  // the column added; SQLite has no "ADD COLUMN IF NOT EXISTS", so just
  // swallow the "duplicate column" error on a fresh table that already has it.
  try {
    await db.execute('ALTER TABLE players ADD COLUMN install_secret_hash TEXT');
  } catch (err) {
    if (!/duplicate column/i.test(err.message || '')) {
      throw err;
    }
  }

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_players_name_lower ON players (display_name_lower)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS personal_bests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      boss TEXT NOT NULL COLLATE NOCASE,
      time_seconds REAL NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(player_id, boss)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_pb_boss ON personal_bests (boss)
  `);
}

module.exports = { db, init };
