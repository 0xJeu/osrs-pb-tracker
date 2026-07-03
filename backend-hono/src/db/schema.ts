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
