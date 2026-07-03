const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { db, init } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'website')));

const now = () => new Date().toISOString();

// --- Install-secret auth ---------------------------------------------------
//
// RuneLite gives plugins no way to cryptographically prove "this request
// really came from account X's game session" to a third-party server - the
// accountHash itself is just an opaque per-account ID, not a secret. So
// instead of proving identity, we do first-claim binding: the plugin
// generates a random secret once on install and sends it (hashed on our
// side before storage) with every sync. The first sync for a given
// accountHash "claims" it by storing that hash; every later sync for the
// same accountHash must present the same secret, or it's rejected. This
// doesn't stop a fast attacker from claiming an account before its real
// owner ever syncs, but it stops anyone else from overwriting an
// already-claimed account's data without the original install's secret.
function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

// Per-accountHash sliding-window rate limit on /api/sync, so a single
// misbehaving install can't hammer the endpoint even with a valid secret.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const syncRequestTimestamps = new Map();

function isRateLimited(key) {
  const nowMs = Date.now();
  const recent = (syncRequestTimestamps.get(key) || []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  recent.push(nowMs);
  syncRequestTimestamps.set(key, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

// --- Helpers -------------------------------------------------------------

async function upsertPlayer(accountHash, displayName, secretHash) {
  const existingResult = await db.execute({
    sql: 'SELECT * FROM players WHERE account_hash = ?',
    args: [accountHash],
  });
  const existing = existingResult.rows[0];
  const nameLower = displayName.toLowerCase();

  if (!existing) {
    const info = await db.execute({
      sql: 'INSERT INTO players (account_hash, display_name, display_name_lower, install_secret_hash, updated_at) VALUES (?, ?, ?, ?, ?)',
      args: [accountHash, displayName, nameLower, secretHash, now()],
    });
    return { playerId: Number(info.lastInsertRowid), authorized: true };
  }

  const storedHash = existing['install_secret_hash'];

  if (!storedHash) {
    // Row synced before install-secret enforcement existed - claim it now
    // rather than locking out data that was already synced honestly.
    await db.execute({
      sql: 'UPDATE players SET install_secret_hash = ? WHERE id = ?',
      args: [secretHash, existing['id']],
    });
  } else if (storedHash !== secretHash) {
    return { playerId: existing['id'], authorized: false };
  }

  if (existing['display_name'] !== displayName) {
    await db.execute({
      sql: 'UPDATE players SET display_name = ?, display_name_lower = ?, updated_at = ? WHERE id = ?',
      args: [displayName, nameLower, now(), existing['id']],
    });
  }

  return { playerId: existing['id'], authorized: true };
}

// Only overwrite a stored PB if the new time is better (lower), or there
// wasn't one before. Boss kill times only ever "improve" in this dataset.
async function upsertPb(playerId, boss, timeSeconds) {
  const existingResult = await db.execute({
    sql: 'SELECT * FROM personal_bests WHERE player_id = ? AND boss = ?',
    args: [playerId, boss],
  });
  const existing = existingResult.rows[0];

  if (!existing) {
    await db.execute({
      sql: 'INSERT INTO personal_bests (player_id, boss, time_seconds, updated_at) VALUES (?, ?, ?, ?)',
      args: [playerId, boss, timeSeconds, now()],
    });
    return true;
  }

  if (timeSeconds < existing['time_seconds']) {
    await db.execute({
      sql: 'UPDATE personal_bests SET time_seconds = ?, updated_at = ? WHERE id = ?',
      args: [timeSeconds, now(), existing['id']],
    });
    return true;
  }

  return false;
}

// --- Routes ----------------------------------------------------------------

app.post('/api/sync', async (req, res) => {
  const { accountHash, displayName, pbs, installSecret } = req.body || {};

  if (!accountHash || typeof accountHash !== 'string') {
    return res.status(400).json({ error: 'accountHash is required' });
  }
  if (!displayName || typeof displayName !== 'string') {
    return res.status(400).json({ error: 'displayName is required' });
  }
  if (!installSecret || typeof installSecret !== 'string' || installSecret.length < 16) {
    return res.status(400).json({ error: 'installSecret is required (min 16 chars)' });
  }
  if (!pbs || typeof pbs !== 'object' || Array.isArray(pbs)) {
    return res.status(400).json({ error: 'pbs must be an object of { bossName: seconds }' });
  }

  if (isRateLimited(accountHash)) {
    return res.status(429).json({ error: 'Too many sync requests for this account, slow down.' });
  }

  try {
    const secretHash = hashSecret(installSecret);
    const { playerId, authorized } = await upsertPlayer(accountHash, displayName, secretHash);

    if (!authorized) {
      return res.status(409).json({
        error: 'This account is already synced from a different install. If this is really you, the original install secret is required.',
      });
    }

    let updated = 0;
    for (const [rawBoss, seconds] of Object.entries(pbs)) {
      const boss = rawBoss.trim().toLowerCase();
      const timeSeconds = Number(seconds);
      if (!boss || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
        continue;
      }
      if (await upsertPb(playerId, boss, timeSeconds)) {
        updated += 1;
      }
    }

    res.json({ ok: true, playerId, received: Object.keys(pbs).length, updated });
  } catch (err) {
    console.error('sync failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

async function playerWithPbs(player) {
  const pbsResult = await db.execute({
    sql: 'SELECT boss, time_seconds, updated_at FROM personal_bests WHERE player_id = ? ORDER BY boss COLLATE NOCASE',
    args: [player['id']],
  });

  return {
    id: player['id'],
    displayName: player['display_name'],
    updatedAt: player['updated_at'],
    pbs: pbsResult.rows.map((row) => ({
      boss: row['boss'],
      timeSeconds: row['time_seconds'],
      updatedAt: row['updated_at'],
    })),
  };
}

// Display names aren't unique (players can rename in-game, and old names get
// reused), so more than one player row can share the same display_name_lower.
// Rather than arbitrarily picking one match, surface all of them and let the
// caller disambiguate - see GET /api/players/by-id/:id.
app.get('/api/players/:name', async (req, res) => {
  try {
    const playersResult = await db.execute({
      sql: 'SELECT * FROM players WHERE display_name_lower = ? ORDER BY updated_at DESC',
      args: [req.params.name.toLowerCase()],
    });

    if (playersResult.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (playersResult.rows.length > 1) {
      return res.json({
        ambiguous: true,
        matches: playersResult.rows.map((player) => ({
          id: player['id'],
          displayName: player['display_name'],
          updatedAt: player['updated_at'],
        })),
      });
    }

    res.json(await playerWithPbs(playersResult.rows[0]));
  } catch (err) {
    console.error('player lookup failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/players/by-id/:id', async (req, res) => {
  try {
    const playerResult = await db.execute({
      sql: 'SELECT * FROM players WHERE id = ?',
      args: [req.params.id],
    });
    const player = playerResult.rows[0];

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json(await playerWithPbs(player));
  } catch (err) {
    console.error('player lookup by id failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toString().toLowerCase().trim();
  if (!q) {
    return res.json([]);
  }
  try {
    const result = await db.execute({
      sql: 'SELECT display_name FROM players WHERE display_name_lower LIKE ? ORDER BY display_name COLLATE NOCASE LIMIT 10',
      args: [`%${q}%`],
    });
    res.json(result.rows.map((r) => r['display_name']));
  } catch (err) {
    console.error('search failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/leaderboard/:boss', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  try {
    const result = await db.execute({
      sql: `
        SELECT p.display_name AS displayName, pb.time_seconds AS timeSeconds, pb.updated_at AS updatedAt
        FROM personal_bests pb
        JOIN players p ON p.id = pb.player_id
        WHERE pb.boss = ? COLLATE NOCASE
        ORDER BY pb.time_seconds ASC
        LIMIT ?
      `,
      args: [req.params.boss, limit],
    });
    res.json(result.rows.map((r) => ({
      displayName: r['displayName'],
      timeSeconds: r['timeSeconds'],
      updatedAt: r['updatedAt'],
    })));
  } catch (err) {
    console.error('leaderboard lookup failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/bosses', async (req, res) => {
  try {
    const result = await db.execute('SELECT DISTINCT boss FROM personal_bests ORDER BY boss COLLATE NOCASE');
    res.json(result.rows.map((r) => r['boss']));
  } catch (err) {
    console.error('boss list failed', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// --- Startup -----------------------------------------------------------

async function start() {
  await init();
  app.listen(PORT, () => {
    console.log(`PB tracker backend listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
