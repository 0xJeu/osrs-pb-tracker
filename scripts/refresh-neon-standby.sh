#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${PRIMARY_DATABASE_URL_UNPOOLED:?Set PRIMARY_DATABASE_URL_UNPOOLED to the active Neon database}"
: "${STANDBY_DATABASE_URL_UNPOOLED:?Set STANDBY_DATABASE_URL_UNPOOLED to the inactive Neon standby}"
: "${PRIMARY_DATABASE_EXPECTED_PROJECT_ID:?Set PRIMARY_DATABASE_EXPECTED_PROJECT_ID}"
: "${PRIMARY_DATABASE_EXPECTED_BRANCH_ID:?Set PRIMARY_DATABASE_EXPECTED_BRANCH_ID}"
: "${PRIMARY_DATABASE_EXPECTED_DATABASE_NAME:?Set PRIMARY_DATABASE_EXPECTED_DATABASE_NAME}"
: "${STANDBY_DATABASE_EXPECTED_PROJECT_ID:?Set STANDBY_DATABASE_EXPECTED_PROJECT_ID}"
: "${STANDBY_DATABASE_EXPECTED_BRANCH_ID:?Set STANDBY_DATABASE_EXPECTED_BRANCH_ID}"
: "${STANDBY_DATABASE_EXPECTED_DATABASE_NAME:?Set STANDBY_DATABASE_EXPECTED_DATABASE_NAME}"

if [[ "$PRIMARY_DATABASE_URL_UNPOOLED" == "$STANDBY_DATABASE_URL_UNPOOLED" ]]; then
  echo "Refusing to refresh: primary and standby URLs are identical." >&2
  exit 1
fi

if [[ "$PRIMARY_DATABASE_URL_UNPOOLED" == *"-pooler."* ]] ||
   [[ "$STANDBY_DATABASE_URL_UNPOOLED" == *"-pooler."* ]]; then
  echo "Refusing to refresh: pg_dump and pg_restore require unpooled Neon URLs." >&2
  exit 1
fi

if [[ "$PRIMARY_DATABASE_EXPECTED_PROJECT_ID" == "$STANDBY_DATABASE_EXPECTED_PROJECT_ID" ]]; then
  echo "Refusing to refresh: primary and standby must use different Neon projects." >&2
  exit 1
fi

for command_name in pg_dump pg_restore psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done

read_database_identity() {
  local database_url="$1"
  psql \
    --no-psqlrc \
    --quiet \
    --tuples-only \
    --no-align \
    --set=ON_ERROR_STOP=1 \
    --dbname="$database_url" \
    --command="SELECT current_setting('neon.project_id', true) || '|' || current_setting('neon.branch_id', true) || '|' || current_database();"
}

verify_database_identity() {
  local label="$1"
  local database_url="$2"
  local expected_project_id="$3"
  local expected_branch_id="$4"
  local expected_database_name="$5"
  local identity
  local actual_project_id
  local actual_branch_id
  local actual_database_name
  local unexpected_field

  identity="$(read_database_identity "$database_url")"
  if [[ "$identity" == *$'\n'* ]] || [[ "$identity" == *$'\r'* ]]; then
    echo "Refusing to refresh: $label returned an invalid Neon identity." >&2
    exit 1
  fi
  IFS='|' read -r \
    actual_project_id \
    actual_branch_id \
    actual_database_name \
    unexpected_field <<< "$identity"

  if [[ -z "$actual_project_id" ]] ||
     [[ -z "$actual_branch_id" ]] ||
     [[ -z "$actual_database_name" ]] ||
     [[ -n "$unexpected_field" ]]; then
    echo "Refusing to refresh: $label returned an invalid Neon identity." >&2
    exit 1
  fi

  if [[ "$actual_project_id" != "$expected_project_id" ]] ||
     [[ "$actual_branch_id" != "$expected_branch_id" ]] ||
     [[ "$actual_database_name" != "$expected_database_name" ]]; then
    echo "Refusing to refresh: $label does not match its expected Neon project, branch, and database." >&2
    exit 1
  fi

  printf '%s|%s|%s\n' \
    "$actual_project_id" \
    "$actual_branch_id" \
    "$actual_database_name"
}

assert_distinct_database_identities() {
  local primary_identity="$1"
  local standby_identity="$2"
  local primary_project="${primary_identity%%|*}"
  local standby_project="${standby_identity%%|*}"

  if [[ "$primary_project" == "$standby_project" ]]; then
    echo "Refusing to refresh: primary and standby resolve to the same Neon project." >&2
    exit 1
  fi
}

primary_identity="$(
  verify_database_identity \
    "primary database" \
    "$PRIMARY_DATABASE_URL_UNPOOLED" \
    "$PRIMARY_DATABASE_EXPECTED_PROJECT_ID" \
    "$PRIMARY_DATABASE_EXPECTED_BRANCH_ID" \
    "$PRIMARY_DATABASE_EXPECTED_DATABASE_NAME"
)"
standby_identity="$(
  verify_database_identity \
    "standby database" \
    "$STANDBY_DATABASE_URL_UNPOOLED" \
    "$STANDBY_DATABASE_EXPECTED_PROJECT_ID" \
    "$STANDBY_DATABASE_EXPECTED_BRANCH_ID" \
    "$STANDBY_DATABASE_EXPECTED_DATABASE_NAME"
)"
assert_distinct_database_identities "$primary_identity" "$standby_identity"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/osrs-pb-standby.XXXXXX")"
chmod 700 "$work_dir"
dump_file="$work_dir/osrs-pb-production.dump"

cleanup() {
  case "$work_dir" in
    "${TMPDIR:-/tmp}"/osrs-pb-standby.*)
      rm -rf -- "$work_dir"
      ;;
    *)
      echo "Refusing to clean unexpected temporary path: $work_dir" >&2
      ;;
  esac
}
trap cleanup EXIT

fingerprint_database() {
  local database_url="$1"
  psql \
    --no-psqlrc \
    --quiet \
    --set=ON_ERROR_STOP=1 \
    --dbname="$database_url" \
    --file="$script_dir/db-fingerprint.sql"
}

source_fingerprint=""
for attempt in 1 2; do
  before_dump="$(fingerprint_database "$PRIMARY_DATABASE_URL_UNPOOLED")"

  pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$dump_file" \
    --dbname="$PRIMARY_DATABASE_URL_UNPOOLED"

  after_dump="$(fingerprint_database "$PRIMARY_DATABASE_URL_UNPOOLED")"
  if [[ "$before_dump" == "$after_dump" ]]; then
    source_fingerprint="$after_dump"
    break
  fi

  if [[ "$attempt" -eq 2 ]]; then
    echo "Primary changed during both backup attempts; standby was not modified." >&2
    exit 1
  fi

  echo "Primary changed during backup attempt; retrying once."
done

standby_identity_before_restore="$(
  verify_database_identity \
    "standby database before restore" \
    "$STANDBY_DATABASE_URL_UNPOOLED" \
    "$STANDBY_DATABASE_EXPECTED_PROJECT_ID" \
    "$STANDBY_DATABASE_EXPECTED_BRANCH_ID" \
    "$STANDBY_DATABASE_EXPECTED_DATABASE_NAME"
)"
if [[ "$standby_identity_before_restore" != "$standby_identity" ]]; then
  echo "Refusing to restore: standby identity changed during the refresh." >&2
  exit 1
fi
assert_distinct_database_identities \
  "$primary_identity" \
  "$standby_identity_before_restore"

pg_restore \
  --clean \
  --if-exists \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --dbname="$STANDBY_DATABASE_URL_UNPOOLED" \
  "$dump_file"

standby_fingerprint="$(fingerprint_database "$STANDBY_DATABASE_URL_UNPOOLED")"
if [[ "$source_fingerprint" != "$standby_fingerprint" ]]; then
  echo "Standby verification failed after restore." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  dump_checksum="$(sha256sum "$dump_file" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  dump_checksum="$(shasum -a 256 "$dump_file" | awk '{print $1}')"
else
  echo "A SHA-256 utility is required (sha256sum or shasum)." >&2
  exit 1
fi
dump_size="$(du -h "$dump_file" | awk '{print $1}')"

echo "Standby refresh verified."
echo "Dump size: $dump_size"
echo "Dump SHA-256: $dump_checksum"
