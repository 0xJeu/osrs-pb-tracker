import { pgTable, serial, integer, text, real, timestamp, unique, index, jsonb } from 'drizzle-orm/pg-core';

export const players = pgTable(
  'players',
  {
    id: serial('id').primaryKey(),
    accountHash: text('account_hash').notNull().unique(),
    displayName: text('display_name').notNull(),
    displayNameLower: text('display_name_lower').notNull(),
    installSecretHash: text('install_secret_hash'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    nameLowerIdx: index('idx_players_name_lower').on(table.displayNameLower),
  })
);

export const playerNameHistory = pgTable(
  'player_name_history',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    displayNameLower: text('display_name_lower').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    playerNameUnique: unique().on(table.playerId, table.displayNameLower),
    nameLowerIdx: index('idx_player_name_history_lower').on(table.displayNameLower),
  })
);

export const personalBests = pgTable(
  'personal_bests',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    // Case-insensitivity is enforced at the application layer (all boss values
    // are lowercased before being written), not by the database — Postgres
    // text() has no NOCASE-equivalent collation like SQLite did.
    boss: text('boss').notNull(),
    timeSeconds: real('time_seconds').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    playerBossUnique: unique().on(table.playerId, table.boss),
    bossIdx: index('idx_pb_boss').on(table.boss),
  })
);

// A rejected install credential is retained only as a one-way hash and a
// quarantined, already-normalized PB payload. It cannot change the player's
// public data until an explicit recovery decision promotes this exact row.
export const installRecoveryCandidates = pgTable(
  'install_recovery_candidates',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    incumbentSecretHash: text('incumbent_secret_hash').notNull(),
    candidateSecretHash: text('candidate_secret_hash').notNull(),
    status: text('status').notNull().default('pending'),
    displayName: text('display_name').notNull(),
    payload: jsonb('payload').$type<Record<string, number>>().notNull(),
    payloadDigest: text('payload_digest').notNull(),
    attemptCount: integer('attempt_count').notNull().default(1),
    receivedCount: integer('received_count').notNull(),
    eligibleCount: integer('eligible_count').notNull(),
    equalCount: integer('equal_count').notNull(),
    improvedCount: integer('improved_count').notNull(),
    newCount: integer('new_count').notNull(),
    slowerCount: integer('slower_count').notNull(),
    missingCount: integer('missing_count').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  },
  (table) => ({
    // The same install may legitimately become a candidate again after a
    // different credential was promoted. Scope decisions to the incumbent
    // binding that existed when the candidate was captured.
    playerCredentialEpochUnique: unique().on(
      table.playerId,
      table.incumbentSecretHash,
      table.candidateSecretHash
    ),
    playerStatusIdx: index('idx_install_recovery_player_status').on(table.playerId, table.status),
    lastSeenAtIdx: index('idx_install_recovery_last_seen_at').on(table.lastSeenAt),
  })
);

// Immutable operator/system decisions for credential recovery. Credential
// hashes and PB payloads deliberately remain on the candidate row and are
// never copied into this support-facing trail.
export const installRecoveryEvents = pgTable(
  'install_recovery_events',
  {
    id: serial('id').primaryKey(),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => installRecoveryCandidates.id, { onDelete: 'cascade' }),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    candidateCreatedAtIdx: index('idx_install_recovery_events_candidate_created_at').on(
      table.candidateId,
      table.createdAt
    ),
    playerCreatedAtIdx: index('idx_install_recovery_events_player_created_at').on(
      table.playerId,
      table.createdAt
    ),
  })
);

// Operational support trail for meaningful accepted changes and rejected
// install bindings. Accepted no-ops and rate-limited requests are deliberately
// omitted so a sync storm cannot turn observability into database write load.
// The trail does not store account hashes, install-secret hashes, IP addresses,
// user agents, or PB payloads.
export const syncAttempts = pgTable(
  'sync_attempts',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    outcome: text('outcome').notNull(),
    httpStatus: integer('http_status').notNull(),
    receivedCount: integer('received_count').notNull(),
    eligibleCount: integer('eligible_count'),
    updatedCount: integer('updated_count'),
    recoveryCandidateId: integer('recovery_candidate_id').references(
      () => installRecoveryCandidates.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    playerCreatedAtIdx: index('idx_sync_attempts_player_created_at').on(table.playerId, table.createdAt),
    createdAtIdx: index('idx_sync_attempts_created_at').on(table.createdAt),
  })
);

// Deliberately minimal - just enough to triage. No IP/user-agent/account
// linkage is stored, both to keep row size small (site is in beta, feedback
// volume is unpredictable) and to avoid collecting more than we need from
// anonymous submitters. Read directly from the database when it's time to
// review (no admin API endpoint exposes this table).
export const feedback = pgTable(
  'feedback',
  {
    id: serial('id').primaryKey(),
    message: text('message').notNull(),
    // Optional short freeform tag for where the feedback came from, e.g. the
    // boss or player page the user was viewing - not a foreign key, just context.
    context: text('context'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_feedback_created_at').on(table.createdAt),
  })
);
