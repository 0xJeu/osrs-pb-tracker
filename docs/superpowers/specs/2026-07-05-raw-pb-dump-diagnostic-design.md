# Raw PB Dump Diagnostic — Design

## Goal

Give a way to inspect exactly what RuneLite's built-in Chat Commands plugin
has cached under `personalbest.*` for a given account, and whether our own
plugin would sync each of those values as-is or is deliberately withholding
them — without relying on the player running `!pb <boss>` per boss in-game.

## Background

Our plugin never observes boss kills itself; it only relays whatever
RuneLite's Chat Commands plugin has already recorded locally in the
`personalbest` RSProfile config group (see the class doc on
`PbTrackerPlugin`). Two real player reports surfaced records that look wrong
on the site (missing awakened Desert Treasure 2 bosses; Scurrius/Cerberus
times far slower than the player's known average despite a high kill count),
and in both cases the most likely explanation traces back to RuneLite's local
cache never having been updated to the player's true fastest kill — not a bug
in our sync/storage/rendering, which has been verified correct against three
other players' real synced data. Confirming that root cause today requires
asking the player to manually run `!pb <boss>` for every suspect boss and
report back the result, which is slow and only checks one boss at a time.

## Scope

**In scope:** a new hidden toggle in the plugin's own Configuration panel
that dumps every raw `personalbest.*` key/value RuneLite currently has
cached, annotated with whether our plugin would sync each one as-is or is
gating it (and why), copied straight to the system clipboard so the player
can paste it to us directly.

**Out of scope:**
- Any backend or frontend change — this is purely local to the plugin.
- Any change to sync behavior, gating logic, or the boss-name canonicalization
  itself. This feature only *reports* on the existing logic, it doesn't alter it.
- A UI panel/widget beyond the existing Configuration-panel checkbox idiom the
  plugin already uses for `syncNow`.

## Design

**Trigger:** a new hidden config item, `dumpRawPbs`, added to
`PbTrackerConfig` following the exact same pattern as `syncNow` — a boolean
checkbox with no persisted meaning of its own; toggling it in either
direction (see the existing comment on `onConfigChanged` about why the
plugin doesn't reset these back programmatically) fires the dump.

```java
@ConfigItem(
    keyName = "dumpRawPbs",
    name = "Copy raw PB data to clipboard",
    description = "Toggle this (either direction) to copy every raw personalbest.* "
        + "value RuneLite has cached, and whether it would sync as-is, to your clipboard.",
    position = 5
)
default boolean dumpRawPbs()
{
    return false;
}
```

**Handling the toggle:** `PbTrackerPlugin.onConfigChanged` gets a new branch
alongside the existing `SYNC_NOW_KEY` check, using the same
`shouldTriggerSyncNow` helper (renamed/reused as a generic "toggle fired"
check) to detect either direction of the toggle:

```java
if (DUMP_RAW_KEY.equals(event.getKey()) && shouldTriggerSyncNow(event.getNewValue()))
{
    executor.execute(this::dumpRawPersonalBests);
}
```

**Gathering the raw data:** `dumpRawPersonalBests()` collects the raw map the
same way `syncAll()` already does — `configManager.getRSProfileConfigurationKeys(CONFIG_GROUP, profileKey, "")`
then `getRSProfileConfiguration(CONFIG_GROUP, boss, double.class)` per key —
into a `Map<String, Double>`.

**Formatting the report:** a new **static, pure** method,

```java
static String buildRawPbReport(Map<String, Double> raw)
```

produces one line per entry, sorted by key for stable output, reusing the
plugin's existing classification logic so the report reflects reality rather
than duplicating it:

- If `shouldSyncRawPersonalBest(key)` is true: `synced as "<canonicalBossKey(key)>"`.
- If false and `KNOWN_DUPLICATE_RAW_KEYS` has an entry for it: `SKIPPED (gated, waiting on Adventure Log Counters -> "<heading>")`.
- If false and it's a raid/team-size variant (no known-duplicate heading): `SKIPPED (raid/team-size variant, waiting on Adventure Log Counters)`.

Example output:

```
personalbest.cerberus = 61.0                 -> synced as "Cerberus"
personalbest.duke sucellus awakened = 353.2  -> synced as "Duke Sucellus (awakened)"
personalbest.scurrius = 596.0                -> synced as "Scurrius"
personalbest.tztok-jad = 132.4               -> SKIPPED (gated, waiting on Adventure Log Counters -> "TzHaar Fight Cave")
```

Being static and pure (`Map<String, Double> in`, `String` out — no
`ConfigManager`, no AWT), this is directly unit-testable the same way
`shouldSyncRawPersonalBest`/`canonicalBossKey` already are, without needing a
RuneLite client or clipboard access in the test environment.

**Copying to the clipboard:** `dumpRawPersonalBests()` calls
`buildRawPbReport`, then copies the resulting string via
`java.awt.Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(report), null)`
— plain JDK, no new dependency (RuneLite itself is a desktop Swing
application, so AWT clipboard access is already available in this runtime).
Finally it calls the existing `setStatus(...)` helper with something like
`"Copied 34 raw PB value(s) to clipboard."`, reusing the plugin's existing
"status lives in the config panel" convention (`SYNC_STATUS_KEY`) rather than
introducing a new UI surface.

**Error handling:** mirrors `syncAll()`'s existing guard — if
`configManager.getRSProfileKey()` is null (not logged in), set status to
`"Not logged in yet - log in, then try again."` and return without touching
the clipboard.

## Testing

Unit test `buildRawPbReport` with a hand-built `Map<String, Double>` covering:
- an ordinary boss (e.g. `"cerberus"` → `61.0`) — expect a `synced as "Cerberus"` line.
- an awakened-boss alias (e.g. `"duke sucellus awakened"`) — expect
  `synced as "Duke Sucellus (awakened)"`.
- a `KNOWN_DUPLICATE_RAW_KEYS` entry (e.g. `"tztok-jad"`) — expect the
  `SKIPPED (gated, ...)` line with the correct heading.
- a raid/team-size variant not in that map (e.g.
  `"chambers of xeric 2 players"`) — expect the generic
  `SKIPPED (raid/team-size variant, ...)` line.

No integration test needed for the clipboard write itself (thin AWT call,
same trust level as the existing untested `setStatus`/`ConfigManager` calls
elsewhere in the plugin).

## Non-goals / explicit limitations

This only reports what RuneLite's Chat Commands plugin has *already* cached
locally — it cannot recover a true personal best that RuneLite never
observed (e.g. a fast kill that happened before the plugin was installed, or
while the in-game boss-kill chat message was disabled). If the dump confirms
RuneLite's own cache is already wrong/stale, the fix is on the player's side
(open Adventure Log → Counters to force a refresh from the game's
authoritative record, then re-sync), not something this feature or our sync
pipeline can correct automatically.
