#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${PRIMARY_DATABASE_URL_UNPOOLED:?Set PRIMARY_DATABASE_URL_UNPOOLED to the active Neon database}"
: "${STANDBY_DATABASE_URL_UNPOOLED:?Set STANDBY_DATABASE_URL_UNPOOLED to the inactive Neon standby}"

if [[ "$PRIMARY_DATABASE_URL_UNPOOLED" == "$STANDBY_DATABASE_URL_UNPOOLED" ]]; then
  echo "Refusing to refresh: primary and standby URLs are identical." >&2
  exit 1
fi

if [[ "$PRIMARY_DATABASE_URL_UNPOOLED" == *"-pooler."* ]] ||
   [[ "$STANDBY_DATABASE_URL_UNPOOLED" == *"-pooler."* ]]; then
  echo "Refusing to refresh: pg_dump and pg_restore require unpooled Neon URLs." >&2
  exit 1
fi

for command_name in pg_dump pg_restore psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done

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
