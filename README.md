# OSRS PB Tracker

A working prototype of the system we discussed: a RuneLite plugin that reads
a player's boss personal best times and syncs them to a backend, plus a
website where anyone can look up a player's PBs or browse a boss leaderboard.

```
osrs-pb-tracker/
  plugin/     RuneLite plugin (Java) — reads PBs, POSTs them to the backend
  backend/    Express + SQLite API — stores PBs, serves the website
  website/    Static HTML/CSS/JS — search + leaderboard UI
```

## How the data flows

RuneLite's built-in **Chat Commands** plugin already tracks every boss PB
you get, in a config store keyed `personalbest.<boss name>` (seconds, as a
double). That's what powers the in-client `!pb` command and what the
collection-log plugin displays. Our plugin doesn't scrape chat or the UI —
it reads that same config value directly via `ConfigManager`.

Two sync paths, both implemented in `PbTrackerPlugin.java`:

- **Live sync** — subscribes to `ConfigChanged` events on the `personalbest`
  group, so the moment you get a new PB in-game it's pushed immediately.
- **Bulk sync** — on login (and via a "Sync all PBs now" button in the
  plugin's sidebar panel), it walks a hardcoded list of ~65 bosses
  (`BossList.java`) and uploads every PB RuneLite already has on record, so
  players don't need to re-kill every boss for the site to have data.

Each sync is tagged with the player's **account hash** (`client.getAccountHash()`),
a stable per-Jagex-account ID — the backend uses it as the real identity key,
and just tracks display name alongside it for lookups/renames.

RuneLite gives plugins no way to cryptographically prove account identity to
a third-party server, so on top of the account hash the plugin also generates
a random **install secret** the first time it runs (stored via `ConfigManager`
under the `pbtracker` config group, never shown in the UI) and sends it with
every sync. The backend binds that secret to an account hash on the first
sync it sees for it, and rejects any later sync for that same account hash
that presents a different secret (`409 Conflict`). This isn't full
authentication — whoever syncs an account hash first "claims" it — but it
stops anyone else from later overwriting an already-claimed account's data,
and `/api/sync` also rate-limits per account hash (30 requests / 10 min) to
blunt casual spam.

## 1. Run the backend + website

```bash
cd backend
npm install
npm start
```

This starts an Express server on `http://localhost:3000` that both serves
the API and hosts the website (`GET /` → `website/index.html`). SQLite data
is stored in `backend/data.db`, created automatically on first run.

Quick smoke test once it's running (`installSecret` just needs to be a
stable, ≥16-character string per "install" - the real plugin generates and
persists a random one automatically, see below):

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"accountHash":"12345","displayName":"Blitzen","installSecret":"local-smoke-test-secret","pbs":{"Nex":214,"Zulrah":118.4}}'

curl http://localhost:3000/api/players/Blitzen
```

Then open `http://localhost:3000` in a browser and search "Blitzen".

## 2. Build and test the plugin

The plugin lives in `plugin/` and is set up exactly like RuneLite's official
[example-plugin](https://github.com/runelite/example-plugin) template,
including its trick for testing without cloning the whole client: a small
`PbTrackerPluginTest.java` (under `src/test/java`) that boots a real
RuneLite client with the plugin pre-loaded, wired up to a `run` Gradle task.

**Prerequisites:** JDK 11+ and Gradle (`brew install gradle`, or via
[sdkman](https://sdkman.io/)). No RuneLite source checkout needed.

```bash
cd plugin
gradle run
```

(If you generate a wrapper first with `gradle wrapper`, you can use
`./gradlew run` afterward instead.)

That command compiles the plugin, downloads the RuneLite client as a
dependency, and launches the actual game client with "PB Tracker Sync"
already loaded — log in with your normal account. A couple of notes:

- It launches in developer mode (`--developer-mode --debug`), which just
  unlocks some extra dev tools; everything else behaves like normal RuneLite.
- Plugins loaded via `loadBuiltin` still need to be toggled on: open the
  wrench-icon **Configuration** panel and search "PB Tracker Sync" if you
  don't see its icon in the sidebar right away.
- In the plugin's settings, set **API base URL** to `http://localhost:3000`
  (the default) while your backend (`backend/`, started separately per step 1)
  is running locally.
- Kill a boss, or click **Sync all PBs now** in the plugin's sidebar panel,
  then refresh the website and search your name.

First run will take a while (Gradle resolving RuneLite + its dependencies).
Subsequent runs are much faster.

To ship it to real users, you'd submit `plugin/` to the
[Plugin Hub](https://runelite.net/plugin-hub/) (open-source, PR to
`runelite/plugin-hub`, manually reviewed) — at which point point the config
default at your real deployed backend URL instead of localhost.

## 3. Known limitations / next steps

- **Boss list is best-effort.** `BossList.java` is a hand-compiled list of
  ~65 bosses/raids. RuneLite's actual internal key names may differ slightly
  for a few irregular ones (multi-mode bosses, raids). If a boss isn't
  syncing, check what key is actually stored (hover the PB line in the
  collection-log plugin, or run `!pb <boss>` in game) and adjust the string
  in `BossList.java` to match — the lookup is case-insensitive.
- **No real user accounts on the website yet.** Anyone can look up any
  synced name; there's no login. That matches the "public leaderboard"
  brief, but if you want players to be able to hide/claim/manage their own
  profile later, you'll need a real auth layer on top of the account-hash
  model.
- **SQLite is fine for a prototype**, but for a public production site
  you'll want a hosted Postgres/MySQL instance.
- **Deployment**: the backend is a plain Node/Express app — deploys as-is to
  Render, Railway, Fly.io, a VPS, etc. Point the plugin's `apiBaseUrl` at
  wherever you host it (must be HTTPS if you want it broadly trusted).
