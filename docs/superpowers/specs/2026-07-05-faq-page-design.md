# FAQ Page — Design

## Goal

Give users a durable, self-serve explanation for why a PB record on the site
might look missing or slower than they expect, so "the data is wrong"
reports get redirected to "here's why, and here's how to fix it" instead.

## Background

Investigation into several real reports (missing awakened Desert Treasure 2
bosses, a Scurrius/Cerberus time far slower than the player's known average
despite 161 kills, a missing Bandos record) all traced back to the same root
cause: our plugin/API/frontend faithfully relay whatever RuneLite's Chat
Commands plugin has cached locally under `personalbest.*` — verified correct
against multiple real players' synced data — but that local cache can itself
be stale or, for some content, simply not exist:

- RuneLite only updates a boss's cached PB when it observes a "new personal
  best" chat message, or when the player opens Adventure Log → Counters
  (which some raid/team-size bosses and a few others are deliberately gated
  behind, per `KNOWN_DUPLICATE_RAW_KEYS`/`looksLikeRaidVariant` in
  `PbTrackerPlugin.java`).
- Some OSRS content (the Godwars Dungeon generals — Bandos, Zilyana,
  Kree'arra, K'ril Tsutsaroth) has no personal-best-time tracking in the game
  at all, only kill count, per RuneLite's own wiki: "Personal best times are
  stored for bosses and activities that keep personal best data in game."

There's no third-party source of truth to diff our data against, so the
honest, defensible response is transparency about where the data comes from
and what a user can do about it — not a stronger accuracy claim.

## Scope

**In scope:** a static FAQ page on the existing frontend, linked from the
site footer, plus a small contextual nudge on the player results page.

**Out of scope:**
- Any backend/API change — purely a frontend content addition.
- The raw-PB-dump diagnostic feature (separate, already-specced effort in
  the plugin repo) — this FAQ is what a user reads *before* that tool would
  ever come into play.
- General site FAQ topics unrelated to data accuracy (e.g. "is my data
  public," "how do I delete my data") — not raised by any report so far;
  can be added later without a redesign.

## Design

**Routing:** the app has no real client-side paths today — all views
(`home`, `player`, `boss`) are driven by query params on `/`
(`viewFromLocation`/`navigate` in `App.tsx`), which is what lets the static
Vercel deploy work without a SPA-fallback rewrite rule. This adds a fourth
view the same way:

```ts
type View =
  | { name: 'home' }
  | { name: 'player'; player: string }
  | { name: 'boss'; boss: string }
  | { name: 'faq' };
```

`viewFromLocation` gains a check for `?page=faq`; `navigate` gains a branch
setting that param when navigating to the `faq` view (and clearing it
otherwise, same as the existing `player`/`boss` handling).

**New component — `src/components/FaqPage.tsx`:** static content, no data
fetching, no props beyond nothing (or optionally a callback to navigate
home, matching the existing `onPickPlayer`-style callback convention used
elsewhere). Renders two Q&A entries:

1. **"Why is my PB missing or slower than I expect?"**
   > We only show what RuneLite has already recorded for your account under
   > its own Personal Best tracking — we don't calculate times ourselves. A
   > few common reasons a number might look off:
   >
   > - **You've never opened your Adventure Log → Counters page.** For team
   >   bosses and a few others (Inferno, Fight Caves, Colosseum, Gauntlet,
   >   Nightmare, raids), that's what tells RuneLite your real record.
   > - **Your "new personal best" chat message might be turned off** in your
   >   OSRS settings. If RuneLite never sees that message, it can't update
   >   your PB — no matter how many times you've beaten it in-game.
   > - **Some bosses don't have a PB at all.** Group bosses like the Godwars
   >   generals (Bandos, Zilyana, Kree'arra, K'ril) only track kill count in
   >   OSRS, not a fastest-kill time — so there's nothing for us (or
   >   RuneLite) to show.

2. **"How do I fix it?"**
   > Open Adventure Log → Counters in-game once, then click **"Sync all PBs
   > now"** in the plugin's Configuration panel. That refreshes RuneLite's
   > cached times from the game's own record and pushes the update to the
   > site.

**Discoverability:**
- A permanent **"FAQ"** link added to `site-footer` in `App.tsx`, next to
  the existing "Data synced from..." line, using the same
  `preventDefault` + `navigate({ name: 'faq' })` click pattern just added
  for the logo-to-home fix.
- A small nudge in `PlayerResult.tsx`, rendered alongside the existing
  results meta line whenever `player.pbs.length > 0`: *"Times look wrong?
  See our FAQ"*, linking to `?page=faq` the same way.

**Styling:** reuses existing `theme.css` classes (`.wrap`, existing text/dim
colors) — no new visual language needed for a text-only page.

## Testing

No unit tests needed — this is static content with no logic branches beyond
the existing view-routing pattern, which is already implicitly covered by
how `player`/`boss` views work today. Verification is a manual/preview check:
footer link and player-page nudge both navigate to the FAQ view and back.
