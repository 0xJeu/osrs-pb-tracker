# Database resilience runbook

## Topology

- Active primary: Neon project `snowy-fire-96856162`, main branch
  `br-plain-leaf-aja8iam5`, database `neondb`.
- Inactive standby: Neon project `wispy-lab-76474839`, main branch
  `br-patient-dust-aw4iwynr`, database `neondb`.
- Isolated Preview: Neon project `wild-rice-11832605`, main branch
  `br-patient-mode-awo4y8j6`, database `neondb`. It has the application schema
  but no copied production rows and is not a failover target.
- The older project `dry-tooth-70023755` is not part of this topology. It has
  unrelated/stale rows and must not be overwritten as part of standby refresh.

The Vercel backend uses environment-scoped database settings.

Production only:

- `DATABASE_URL_PRIMARY`: pooled primary connection string.
- `DATABASE_URL_STANDBY`: pooled standby connection string.
- `DATABASE_TARGET`: `primary` or `standby`; defaults to `primary`.
- `DATABASE_URL`: temporary backward-compatible fallback for the primary.

Preview and Development only:

- `DATABASE_URL`: a dedicated non-production database connection string.
- Do not expose `DATABASE_URL_PRIMARY`, `DATABASE_URL_STANDBY`, or
  `DATABASE_TARGET` to these environments.

The application ignores the production selectors whenever Vercel reports a
non-production environment. Preview and Development fail closed if their
scoped `DATABASE_URL` is missing.

There is no automatic write failover. This is deliberate: automatically
sending writes to whichever database answers first can create split-brain
state and lose PB updates during failback.

## Standby refresh

The `Refresh Neon standby` GitHub Actions workflow makes a consistent full
backup of the active primary every six hours and atomically restores it into
the inactive standby.

Required GitHub Actions secrets:

- `PRIMARY_DATABASE_URL_UNPOOLED`
- `STANDBY_DATABASE_URL_UNPOOLED`

Both must be unpooled Neon connection strings. Never commit or print them.

Required GitHub Actions repository variables:

- `NEON_STANDBY_REFRESH_ENABLED=true`
- `PRIMARY_DATABASE_EXPECTED_PROJECT_ID`
- `PRIMARY_DATABASE_EXPECTED_BRANCH_ID`
- `PRIMARY_DATABASE_EXPECTED_DATABASE_NAME`
- `STANDBY_DATABASE_EXPECTED_PROJECT_ID`
- `STANDBY_DATABASE_EXPECTED_BRANCH_ID`
- `STANDBY_DATABASE_EXPECTED_DATABASE_NAME`

The expected-identity variables are non-secret safeguards. They must identify
the same projects, branches, and databases as their corresponding connection
secrets. Primary and standby must use different Neon project IDs.

The refresh script:

1. Refuses identical or pooled URLs.
2. Queries both connections for their server-reported Neon project, branch,
   and database identities.
3. Refuses unexpected project, branch, or database identities and refuses a
   shared primary/standby project, even when their URL strings differ.
4. Fingerprints the source before and after the dump.
5. Retries once if source data changed during the backup.
6. Re-verifies the standby identity immediately before the destructive restore.
7. Restores with `--single-transaction`, preserving the previous standby if
   restore fails.
8. Verifies every application table plus constraints, indexes, and sequences.
9. Deletes the temporary dump from the runner.

No database dump is uploaded as a GitHub Actions artifact because it contains
account identifiers, install-secret hashes, and private feedback.

## Promotion procedure

1. Set `NEON_STANDBY_REFRESH_ENABLED=false` before promotion. This prevents
   new refresh jobs from starting, but it does not cancel a job that is already
   queued or running.
2. Confirm there are no active refresh jobs:

   ```bash
   gh run list --repo 0xJeu/osrs-pb-tracker \
     --workflow "Refresh Neon standby" --status queued
   gh run list --repo 0xJeu/osrs-pb-tracker \
     --workflow "Refresh Neon standby" --status in_progress
   ```

   Both commands must return no runs. Wait for or cancel any active refresh
   before continuing. Never promote a database while it is being refreshed.
3. Record the latest successful standby-refresh workflow and its timestamp.
4. If the old primary is reachable, run one final manual refresh and verify it.
   Repeat the active-run check after that refresh completes.
5. Set the backend Vercel project's `DATABASE_TARGET` to `standby` for
   Production. Do not change either database URL.
6. Redeploy the backend.
7. Verify:
   - `/api/stats`
   - `/api/bosses`
   - `/api/recent-syncs`
   - one existing player profile
   - one controlled plugin sync
8. Treat the promoted project as authoritative immediately. Do not point
   production back at the old primary until changes made after promotion have
   been copied back and verified.

Changing a Vercel environment variable does not alter an already-running
deployment. A new deployment is required before `DATABASE_TARGET` takes
effect. The same selector is used by the Vercel migration build step, so the
selected database receives any pending schema migrations.

## Failback

Failback is a migration, not a configuration toggle:

1. Keep standby refresh disabled.
2. Dump the currently active project.
3. Atomically restore it into the recovered inactive project.
4. Verify full fingerprints.
5. Switch `DATABASE_TARGET` only after parity succeeds, then redeploy.
6. Update the GitHub Action secrets so `PRIMARY_DATABASE_URL_UNPOOLED` names
   the newly active project and `STANDBY_DATABASE_URL_UNPOOLED` names the newly
   inactive project.
7. Update all six expected project/branch/database variables to match the newly
   active and inactive projects. Never swap connection secrets without also
   swapping and verifying their expected identities.
8. Re-enable scheduled refresh.

## Free-tier operating limits

- Continuous PostgreSQL logical replication is intentionally not used. It can
  keep both computes awake and consume both projects' Free allowances.
- Before downgrading, cap both computes at the smallest practical size and
  confirm five-minute scale-to-zero behavior. Apply the same limits to the
  isolated Preview compute.
- Review Neon usage at least weekly. The standby is expected to wake only for
  its scheduled refresh.
- This design has a recovery-point objective of at most six hours. RuneLite's
  local PB cache can re-submit more recent PBs after promotion, but it is not a
  substitute for the standby.
- Keep a separate encrypted off-provider dump for disaster recovery. The
  standby protects availability; it is not protection against accidental
  deletion propagated by a later refresh.
