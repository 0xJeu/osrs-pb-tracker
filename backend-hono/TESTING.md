# Backend database environments

The backend uses two branches in the isolated `dry-tooth` Neon project. Neither
branch is production and no production rows are copied into either one.

## Destructive test branch

`.env.test` targets the `test` branch. Vitest deletes all application rows
between tests, so this branch must never contain persistent fixture data.

```bash
cp .env.test.example .env.test
npm run db:migrate:test
npm test
```

Both commands verify Neon's server-reported project and branch IDs before doing
work. CI supplies the same fixed IDs alongside the `DATABASE_URL_TEST` secret.
If that secret is ever changed to a different branch, CI fails closed.

## Seeded staging branch

`.env.staging` targets the isolated project's `main` branch. It holds a stable,
synthetic dataset for manual API checks, frontend integration, leaderboards,
name-history lookup, tied ranks, raid variants, and sync-attempt diagnostics.

```bash
cp .env.staging.example .env.staging
npm run db:migrate:staging
npm run db:seed:staging -- --confirm
npm run db:smoke:staging
npm run api:smoke:staging
```

The seed is additive and idempotent: it upserts only account hashes prefixed
with `staging-` and does not delete pre-existing rows. The fixture install
secrets are intentionally non-secret staging values whose hashes are stored in
the database.

`db:smoke:staging` validates the database fixtures directly. The read-only
`api:smoke:staging` command runs the real Hono profile, leaderboard, search,
recent-sync, and stats handlers against that dataset without starting a server.

Do not point the deployed production backend at either branch. Production
continues to use the generic `npm run db:migrate` command during deployment;
the guarded commands above are only for test and staging.
