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

## Install recovery workflow

Install-secret mismatches no longer have to be diagnosed from a bare 409. The
sync is quarantined as a recovery candidate, its PB continuity is measured
against the canonical player, and the response includes a non-secret recovery
ID. The canonical install credential and PB rows remain unchanged until an
operator explicitly promotes the candidate.

Run the focused end-to-end integration coverage against the destructive test
branch:

```bash
npm run db:migrate:test
npm test -- test/install-recovery.test.ts
```

For manual local API testing, start the backend with the guarded test target:

```bash
npm run dev:test
```

Send one synthetic sync to create the player, then send the same account hash
with a different install secret to create a candidate:

```bash
curl -X POST http://localhost:3000/api/sync \
  -H 'Content-Type: application/json' \
  -d '{"accountHash":"local-recovery-demo","displayName":"0xSteph Recovery","installSecret":"local-incumbent-secret-0001","pbs":{"Zulrah":80,"Vorkath":70}}'

curl -X POST http://localhost:3000/api/sync \
  -H 'Content-Type: application/json' \
  -d '{"accountHash":"local-recovery-demo","displayName":"0xSteph Recovery","installSecret":"local-candidate-secret-0002","pbs":{"Zulrah":75,"Vorkath":70,"Araxxor":100}}'
```

Never use a real player or production credential in the destructive test
database. Inspect only safe candidate metadata (the command never prints
credential hashes or PB payloads):

```bash
npm run recovery:test -- list
```

Promote a pending candidate or reject a pending/contested candidate with an
explicit actor and optional reason:

```bash
npm run recovery:test -- promote 123 0xSteph local-recovery-test
npm run recovery:test -- reject 124 0xSteph competing-install
```

Promotion is atomic and compare-and-swap protected: it succeeds only while the
player still has the incumbent credential captured with the candidate. It then
replays the quarantined PBs using the normal faster-only rule. A contested
candidate cannot be promoted by this first implementation; it can only be
rejected pending a future explicit contested-recovery policy.

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
