import { pgTable, serial, integer, text, real, timestamp, unique, index } from 'drizzle-orm/pg-core';

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
