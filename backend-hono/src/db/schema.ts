import { pgTable, serial, integer, text, real, timestamp, unique } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  accountHash: text('account_hash').notNull().unique(),
  displayName: text('display_name').notNull(),
  displayNameLower: text('display_name_lower').notNull(),
  installSecretHash: text('install_secret_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const personalBests = pgTable(
  'personal_bests',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    boss: text('boss').notNull(),
    timeSeconds: real('time_seconds').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    playerBossUnique: unique().on(table.playerId, table.boss),
  })
);
