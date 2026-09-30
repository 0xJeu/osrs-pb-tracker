import { db } from '../../db/client.js';
import {
  isPublicSnapshotV1,
  normalizePublicSnapshotDates,
  type PublicSnapshotV1,
} from './schema.js';

// One SQL statement gives every component the same Postgres MVCC snapshot.
// The trigger-maintained revision is read inside that statement, so the
// payload can never pair data from one revision with a counter from another.
const BUILD_PUBLIC_SNAPSHOT_SQL = `
WITH
public_players AS (
  SELECT id, display_name, display_name_lower, updated_at FROM players
),
ranked_pbs AS (
  SELECT player_id, boss, time_seconds, updated_at,
    RANK() OVER (PARTITION BY boss ORDER BY time_seconds ASC)::integer AS rank
  FROM personal_bests
),
profiles AS (
  SELECT p.id,
    jsonb_build_object(
      'id', p.id,
      'displayName', p.display_name,
      'updatedAt', p.updated_at,
      'pbs', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'boss', rp.boss,
            'timeSeconds', rp.time_seconds,
            'updatedAt', rp.updated_at,
            'rank', rp.rank
          ) ORDER BY rp.boss
        ) FILTER (WHERE rp.player_id IS NOT NULL),
        '[]'::jsonb
      )
    ) AS profile
  FROM public_players p
  LEFT JOIN ranked_pbs rp ON rp.player_id = p.id
  GROUP BY p.id, p.display_name, p.updated_at
),
lookup_sources AS (
  SELECT display_name_lower AS lookup_name, id AS player_id, 0 AS source_priority, updated_at
  FROM public_players
  UNION ALL
  SELECT h.display_name_lower, p.id, 1, p.updated_at
  FROM player_name_history h
  JOIN public_players p ON p.id = h.player_id
),
deduped_lookup AS (
  SELECT lookup_name, player_id, MIN(source_priority) AS source_priority, MAX(updated_at) AS updated_at
  FROM lookup_sources
  GROUP BY lookup_name, player_id
),
lookup_names AS (
  SELECT lookup_name,
    jsonb_agg(player_id ORDER BY source_priority, updated_at DESC, player_id) AS player_ids
  FROM deduped_lookup
  GROUP BY lookup_name
)
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'revision', state.revision::text,
  'generatedAt', clock_timestamp(),
  'sourceCounts', jsonb_build_object(
    'players', (SELECT count(*) FROM public_players),
    'nameHistory', (SELECT count(*) FROM player_name_history),
    'personalBests', (SELECT count(*) FROM personal_bests),
    'bosses', (SELECT count(DISTINCT boss) FROM personal_bests)
  ),
  'bosses', COALESCE(
    (SELECT jsonb_agg(boss ORDER BY boss) FROM (SELECT DISTINCT boss FROM personal_bests) b),
    '[]'::jsonb
  ),
  'playerIdsByLookupName', COALESCE(
    (SELECT jsonb_object_agg(lookup_name, player_ids) FROM lookup_names),
    '{}'::jsonb
  ),
  'profilesByPlayerId', COALESCE(
    (SELECT jsonb_object_agg(id::text, profile) FROM profiles),
    '{}'::jsonb
  )
) AS snapshot
FROM public_read_model_state state
WHERE state.id = 1
`;

export async function buildPublicSnapshot(): Promise<PublicSnapshotV1> {
  const rows = await db.$client(BUILD_PUBLIC_SNAPSHOT_SQL);
  const snapshot = rows[0]?.snapshot;
  if (!isPublicSnapshotV1(snapshot)) {
    throw new Error('Public snapshot query returned an invalid or missing document');
  }
  return normalizePublicSnapshotDates(snapshot);
}
