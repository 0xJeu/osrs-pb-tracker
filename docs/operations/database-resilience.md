# Database resilience runbook

## Topology

- Active primary: Neon project `snowy-fire-96856162`, main branch
  `br-plain-leaf-aja8iam5`.
- Inactive standby: Neon project `wispy-lab-76474839`, main branch
  `br-patient-dust-aw4iwynr`.
- The older project `dry-tooth-70023755` is not part of this topology. It has
  unrelated/stale rows and must not be overwritten as part of standby refresh.

The Vercel backend uses an explicit database selector:

- `DATABASE_URL_PRIMARY`: pooled primary connection string.
- `DATABASE_URL_STANDBY`: pooled standby connection string.
- `DATABASE_TARGET`: `primary` or `standby`; defaults to `primary`.
- `DATABASE_URL`: temporary backward-compatible fallback for the primary.

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

Required GitHub Actions repository variable:

- `NEON_STANDBY_REFRESH_ENABLED=true`

The refresh script:

1. Refuses identical or pooled URLs.
2. Fingerprints the source before and after the dump.
3. Retries once if source data changed during the backup.
4. Restores with `--single-transaction`, preserving the previous standby if
   restore fails.
5. Verifies every application table plus constraints, indexes, and sequences.
6. Deletes the temporary dump from the runner.

No database dump is uploaded as a GitHub Actions artifact because it contains
account identifiers, install-secret hashes, and private feedback.

## Promotion procedure

1. Set `NEON_STANDBY_REFRESH_ENABLED=false` before promotion. Never refresh a
   database that is serving production.
2. Record the latest successful standby-refresh workflow and its timestamp.
3. If the old primary is reachable, run one final manual refresh and verify it.
4. Set the backend Vercel project's `DATABASE_TARGET` to `standby` for
   Production. Do not change either database URL.
5. Redeploy the backend.
6. Verify:
   - `/api/stats`
   - `/api/bosses`
   - `/api/recent-syncs`
   - one existing player profile
   - one controlled plugin sync
7. Treat the promoted project as authoritative immediately. Do not point
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
7. Re-enable scheduled refresh.

## Free-tier operating limits

- Continuous PostgreSQL logical replication is intentionally not used. It can
  keep both computes awake and consume both projects' Free allowances.
- Before downgrading, cap both computes at the smallest practical size and
  confirm five-minute scale-to-zero behavior.
- Review Neon usage at least weekly. The standby is expected to wake only for
  its scheduled refresh.
- This design has a recovery-point objective of at most six hours. RuneLite's
  local PB cache can re-submit more recent PBs after promotion, but it is not a
  substitute for the standby.
- Keep a separate encrypted off-provider dump for disaster recovery. The
  standby protects availability; it is not protection against accidental
  deletion propagated by a later refresh.
