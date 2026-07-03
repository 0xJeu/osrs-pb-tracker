# PB Tracker Sync

A RuneLite plugin that reads the boss personal best times RuneLite's built-in
Chat Commands plugin already tracks (config group `personalbest`) and syncs
them to a custom PB leaderboard backend, so they can be looked up by player
name or browsed as a leaderboard on a companion website.

## Features

- **Live sync** — the moment you get a new PB in-game, it's pushed
  immediately.
- **Bulk sync** — on login, and via the "Sync all PBs now" checkbox in the
  plugin's own Configuration panel, every personal best RuneLite already has
  on record is uploaded in one go.
- **Adventure Log parsing** — raid/team-size records (e.g. Theatre of Blood
  "Room time" vs "Overall time" vs team size) are ambiguous in RuneLite's raw
  config, so the plugin also reads your in-game Adventure Log → Counters page
  directly to label these distinctly (e.g. "Theatre of Blood - Fastest
  Room (3 player)").

There's no separate sidebar panel — everything lives in one place: the
plugin's Configuration screen (wrench icon → search "PB Tracker Sync").

## Configuration

| Setting | Description | Default |
|---|---|---|
| API base URL | Base URL of your PB tracker backend | `http://localhost:3000` |
| Auto-sync new PBs | Push a PB the moment RuneLite records one | On |
| Sync all PBs on login | Bulk-upload every known PB shortly after login | On |
| Sync all PBs now | Toggle (either direction) to trigger an immediate bulk sync | Off |
| Last synced | Display only — shows "Last updated: `<timestamp>`" after each successful sync (or an error/nudge message if something needs attention). Technically an editable text box since RuneLite has no true read-only field type, but it's overwritten on every sync | "Never" |

## Building / testing locally

See the top-level repo README for the full local dev setup (backend + test
harness via `gradle run`). This plugin has no dependency on a specific
backend implementation — point **API base URL** at whatever instance you're
running.

## Privacy note

This plugin sends your account hash (RuneLite's stable per-account
identifier, not your password or any Jagex credential) and your current
in-game display name to whatever server is configured under **API base
URL**. By default that's `http://localhost:3000` — nothing leaves your own
machine unless you change it.
