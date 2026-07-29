\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SET TIME ZONE 'UTC';

SELECT table_name || '|' || row_count || '|' || max_id || '|' || digest
FROM (
  SELECT
    'feedback' AS table_name,
    count(*)::text AS row_count,
    coalesce(max(id), 0)::text AS max_id,
    coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY id)), md5('')) AS digest
  FROM feedback t

  UNION ALL

  SELECT
    'personal_bests',
    count(*)::text,
    coalesce(max(id), 0)::text,
    coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY id)), md5(''))
  FROM personal_bests t

  UNION ALL

  SELECT
    'player_name_history',
    count(*)::text,
    coalesce(max(id), 0)::text,
    coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY id)), md5(''))
  FROM player_name_history t

  UNION ALL

  SELECT
    'players',
    count(*)::text,
    coalesce(max(id), 0)::text,
    coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY id)), md5(''))
  FROM players t

  UNION ALL

  SELECT
    'sync_attempts',
    count(*)::text,
    coalesce(max(id), 0)::text,
    coalesce(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY id)), md5(''))
  FROM sync_attempts t
) application_tables
ORDER BY table_name;

SELECT 'constraints|' || count(*) || '|' ||
  coalesce(md5(string_agg(conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conname)), md5(''))
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace;

SELECT 'indexes|' || count(*) || '|' ||
  coalesce(md5(string_agg(indexname || ':' || indexdef, ',' ORDER BY indexname)), md5(''))
FROM pg_indexes
WHERE schemaname = 'public';

SELECT 'sequences|' || count(*) || '|' ||
  coalesce(
    md5(string_agg(sequencename || ':' || coalesce(last_value::text, 'null'), ',' ORDER BY sequencename)),
    md5('')
  )
FROM pg_sequences
WHERE schemaname = 'public';
