#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
subject="$script_dir/refresh-neon-standby.sh"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/osrs-pb-refresh-test.XXXXXX")"
fake_bin="$test_dir/bin"
mkdir -p "$fake_bin"

cleanup() {
  case "$test_dir" in
    "${TMPDIR:-/tmp}"/osrs-pb-refresh-test.*)
      rm -rf -- "$test_dir"
      ;;
    *)
      echo "Refusing to clean unexpected test path: $test_dir" >&2
      ;;
  esac
}
trap cleanup EXIT

cat > "$fake_bin/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

database_url=""
sql_command=""
sql_file=""
for argument in "$@"; do
  case "$argument" in
    --dbname=*)
      database_url="${argument#--dbname=}"
      ;;
    --command=*)
      sql_command="${argument#--command=}"
      ;;
    --file=*)
      sql_file="${argument#--file=}"
      ;;
  esac
done

if [[ -n "$sql_command" ]]; then
  if [[ "$database_url" == "$FAKE_PRIMARY_URL" ]]; then
    printf '%s\n' "$FAKE_PRIMARY_IDENTITY"
    exit 0
  fi

  if [[ "$database_url" == "$FAKE_STANDBY_URL" ]]; then
    counter_file="$FAKE_STATE_DIR/standby-identity-count"
    count=0
    if [[ -f "$counter_file" ]]; then
      read -r count < "$counter_file"
    fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$counter_file"

    if [[ "$count" -gt 1 ]] &&
       [[ -n "${FAKE_STANDBY_IDENTITY_SECOND:-}" ]]; then
      printf '%s\n' "$FAKE_STANDBY_IDENTITY_SECOND"
    else
      printf '%s\n' "$FAKE_STANDBY_IDENTITY"
    fi
    exit 0
  fi

  echo "Unexpected fake identity URL." >&2
  exit 1
fi

if [[ -n "$sql_file" ]]; then
  printf '%s\n' "${FAKE_FINGERPRINT:-matching-fingerprint}"
  exit 0
fi

echo "Unexpected fake psql invocation." >&2
exit 1
EOF

cat > "$fake_bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

dump_file=""
for argument in "$@"; do
  case "$argument" in
    --file=*)
      dump_file="${argument#--file=}"
      ;;
  esac
done

if [[ -z "$dump_file" ]]; then
  echo "Fake pg_dump did not receive --file." >&2
  exit 1
fi

printf '%s\n' "fake database dump" > "$dump_file"
EOF

cat > "$fake_bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "called" > "$FAKE_STATE_DIR/pg-restore-called"
exit 0
EOF

chmod 700 "$fake_bin/psql" "$fake_bin/pg_dump" "$fake_bin/pg_restore"

primary_url="postgresql://primary.example/neondb"
standby_url="postgresql://standby.example/neondb"
primary_identity="primary-project|primary-branch|neondb"
standby_identity="standby-project|standby-branch|neondb"

run_subject() {
  local case_name="$1"
  shift
  local state_dir="$test_dir/state-$case_name"
  mkdir -p "$state_dir"

  env \
    PATH="$fake_bin:/usr/bin:/bin" \
    PRIMARY_DATABASE_URL_UNPOOLED="$primary_url" \
    STANDBY_DATABASE_URL_UNPOOLED="$standby_url" \
    PRIMARY_DATABASE_EXPECTED_PROJECT_ID="primary-project" \
    PRIMARY_DATABASE_EXPECTED_BRANCH_ID="primary-branch" \
    PRIMARY_DATABASE_EXPECTED_DATABASE_NAME="neondb" \
    STANDBY_DATABASE_EXPECTED_PROJECT_ID="standby-project" \
    STANDBY_DATABASE_EXPECTED_BRANCH_ID="standby-branch" \
    STANDBY_DATABASE_EXPECTED_DATABASE_NAME="neondb" \
    FAKE_PRIMARY_URL="$primary_url" \
    FAKE_STANDBY_URL="$standby_url" \
    FAKE_PRIMARY_IDENTITY="$primary_identity" \
    FAKE_STANDBY_IDENTITY="$standby_identity" \
    FAKE_STATE_DIR="$state_dir" \
    "$@" \
    bash "$subject"
}

assert_failure() {
  local case_name="$1"
  local expected_message="$2"
  shift 2
  local output
  local status

  set +e
  output="$(run_subject "$case_name" "$@" 2>&1)"
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "Expected failure for $case_name, but the refresh succeeded." >&2
    exit 1
  fi
  if [[ "$output" != *"$expected_message"* ]]; then
    echo "Failure for $case_name did not include: $expected_message" >&2
    echo "$output" >&2
    exit 1
  fi
  if [[ -f "$test_dir/state-$case_name/pg-restore-called" ]]; then
    echo "Failure case $case_name reached the destructive restore." >&2
    exit 1
  fi
}

assert_success() {
  local case_name="$1"
  shift
  local output

  output="$(run_subject "$case_name" "$@" 2>&1)"
  if [[ "$output" != *"Standby refresh verified."* ]]; then
    echo "Success case $case_name did not finish verification." >&2
    echo "$output" >&2
    exit 1
  fi
  if [[ ! -f "$test_dir/state-$case_name/pg-restore-called" ]]; then
    echo "Success case $case_name did not reach the restore." >&2
    exit 1
  fi
}

assert_failure \
  "missing-expected-identity" \
  "Set STANDBY_DATABASE_EXPECTED_DATABASE_NAME" \
  STANDBY_DATABASE_EXPECTED_DATABASE_NAME=

assert_failure \
  "identical-url" \
  "primary and standby URLs are identical" \
  STANDBY_DATABASE_URL_UNPOOLED="$primary_url"

assert_failure \
  "pooled-url" \
  "require unpooled Neon URLs" \
  STANDBY_DATABASE_URL_UNPOOLED="postgresql://standby-pooler.example/neondb"

assert_failure \
  "same-expected-project-different-branch" \
  "primary and standby must use different Neon projects" \
  STANDBY_DATABASE_EXPECTED_PROJECT_ID="primary-project" \
  STANDBY_DATABASE_EXPECTED_BRANCH_ID="different-branch"

assert_failure \
  "same-database-different-url" \
  "standby database does not match its expected Neon project, branch, and database" \
  FAKE_STANDBY_IDENTITY="$primary_identity"

assert_failure \
  "wrong-primary-identity" \
  "primary database does not match its expected Neon project, branch, and database" \
  FAKE_PRIMARY_IDENTITY="wrong-project|primary-branch|neondb"

assert_failure \
  "wrong-primary-database-name" \
  "primary database does not match its expected Neon project, branch, and database" \
  FAKE_PRIMARY_IDENTITY="primary-project|primary-branch|postgres"

assert_failure \
  "wrong-standby-database-name" \
  "standby database does not match its expected Neon project, branch, and database" \
  FAKE_STANDBY_IDENTITY="standby-project|standby-branch|postgres"

assert_failure \
  "invalid-standby-identity" \
  "standby database returned an invalid Neon identity" \
  FAKE_STANDBY_IDENTITY="standby-project||neondb"

assert_failure \
  "standby-changed-before-restore" \
  "standby database before restore does not match its expected Neon project, branch, and database" \
  FAKE_STANDBY_IDENTITY_SECOND="standby-project|standby-branch|other_database"

assert_success "distinct-verified-identities"

echo "Standby refresh safety tests passed."
