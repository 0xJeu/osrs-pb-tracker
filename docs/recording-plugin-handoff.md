# Handoff: RuneLite Rolling-Buffer Clip Recorder Plugin

## Goal

Build a RuneLite plugin that keeps a **rolling buffer of the last N seconds of
gameplay frames** and automatically saves a video clip when something notable
happens — like a ShadowPlay/"clip that" button for OSRS. Auto-trigger on:

- **Valuable drops** (loot above a configurable GE value threshold)
- **New personal bests** (boss/raid kill times)
- **Achievements** (quest completions, combat achievements, diaries, level-ups)
- **Collection log slots** (new collection log entries)
- Plus a **manual hotkey** ("clip the last 30 seconds now")

This lives alongside (or inside) the existing `plugin/` module in this repo
(`com.pbtracker.PbTrackerPlugin`, the PB Tracker Sync plugin). Long-term idea:
new PBs auto-save a clip, and the clip could be surfaced on the PB leaderboard
website.

## Research already done (2026-07): is this allowed?

**Yes — no rule blocks it, but there are hard technical constraints.**

- Jagex's third-party client guidelines target unfair gameplay advantage.
  Recording your own screen provides none (OBS/streaming is ubiquitous), so
  recording itself is fine.
- RuneLite's [Rejected or Rolled Back Features](https://github.com/runelite/runelite/wiki/Rejected-or-Rolled-Back-Features)
  list does **not** include recording. Core RuneLite declined a *built-in*
  recorder ([issue #4920](https://github.com/runelite/runelite/issues/4920),
  closed "wontfix") — that's a maintenance decision, not a ban; the Plugin Hub
  is the right home for it.
- Precedent: the [RuneMonk Recorder](https://github.com/Dezinater/runemonk-recorder)
  Plugin Hub plugin records scene data for playback, so "recording" as a
  category has passed review.
- **Plugin Hub hard rules** ([Plugin Hub Review](https://github.com/runelite/runelite/wiki/Plugin-Hub-Review),
  [plugin-hub repo](https://github.com/runelite/plugin-hub)):
  - Java only. No native code, no JNI → **no native ffmpeg libs**.
  - No executing external programs → **no shelling out to an ffmpeg binary**.
  - No downloading code at runtime.
  - No reflection.
  - New dependencies are allowed but must be hash-verified in the build and
    slow down review — keep them minimal.
  - Reviewers merge at their discretion: "if it is difficult for us to ensure
    the plugin isn't against the rules we will not merge it."
- **Recommended before building for the Hub:** ask in RuneLite Discord
  #plugin-hub whether they'd accept a clip recorder. Nothing suggests they
  wouldn't, but a 2-minute question beats a rejected PR. (You can build and
  sideload it locally regardless.)

## Architecture

### Frame capture (the easy part)

RuneLite's `DrawManager` is the supported capture API — the core screenshot
plugin uses `drawManager.requestNextFrameListener(image -> ...)` to grab the
rendered frame as a `java.awt.Image`. For continuous capture, re-request a
frame listener every frame (or use `registerEveryFrameListener` if available in
the current API — check `net.runelite.client.ui.DrawManager` source for the
current method names).

Pipeline:

1. Every captured frame: downscale if configured (e.g. cap at 1280px wide),
   convert to `BufferedImage`, timestamp it.
2. Push into a **bounded ring buffer** (e.g. `ArrayDeque` guarded, or a
   fixed-size array with head index) sized to `bufferSeconds × captureFps`.
   Evict oldest on overflow.
3. **Memory is the main design constraint.** Raw 1280×720 ARGB ≈ 3.7 MB/frame;
   30 s at 20 fps raw = ~2.2 GB — not acceptable. Compress frames to JPEG
   (`ImageIO`/`javax.imageio` — zero new dependencies) *as they enter the
   buffer* on a background executor. 720p JPEG q=0.8 ≈ 100–200 KB/frame →
   30 s @ 20 fps ≈ 60–120 MB. Acceptable, and makes MJPEG output nearly free.
4. Capture at reduced fps (default 15–20, configurable), not the client's full
   ~50 fps. Do JPEG encoding off the client thread
   (`ScheduledExecutorService` is injectable, same as the existing plugin).

### Clip encoding (the hard part — pure Java only)

Options, in recommended order:

1. **MJPEG-in-AVI (recommended v1).** Frames are already JPEGs in the buffer;
   an AVI/MJPEG muxer is ~300 lines of plain Java (well-documented format),
   zero dependencies, and writing a clip is just concatenating buffered JPEGs
   with headers. Plays in VLC/most players. Large files (~2–4 MB/s) but clips
   are short.
2. **JCodec** (`org.jcodec:jcodec` + `jcodec-javase`) — pure-Java H.264/MP4.
   Produces real .mp4s that play everywhere and upload to Discord nicely, but
   it's slow; encode **after** the trigger fires, from the buffered JPEGs, on
   a background thread (never real-time). Adds a dependency (hash-verify it).
3. **Animated GIF** — pure Java, trivially shareable, but huge files and 256
   colors. Maybe a config option for very short clips.

Suggested plan: ship v1 with MJPEG/AVI (no deps), add JCodec MP4 as a
follow-up config option ("Clip format: AVI (fast) / MP4 (smaller)").

**Audio: out of scope.** Capturing game audio from inside the JVM is not
practically doable under Hub rules. Video-only, state it in the README.

### Trigger detection

On trigger: mark the buffer, keep capturing for `postRollSeconds` (default
~10 s so the loot/level-up animation is included), then hand the frame range
to the encoder thread and write to disk
(`RuneLite.RUNELITE_DIR/clips/<player>/<timestamp>-<reason>.avi`).
Debounce: overlapping triggers within the same window extend/merge into one
clip rather than writing duplicates.

| Trigger | Detection | Notes |
|---|---|---|
| Valuable drop | `LootReceived` event (`net.runelite.client.events.LootReceived`, from the loot tracker API) + `ItemManager.getItemPrice()`; config threshold (e.g. 1M gp). Also `ChatMessage` regex on "Valuable drop:" / untradeable drop messages as fallback | Core loot tracker & screenshot plugins show exactly how; copy their approach |
| New PB | `ChatMessage` containing "(new personal best)" — this is what the core Chat Commands plugin parses; alternatively `ConfigChanged` on group `personalbest` (exactly what `PbTrackerPlugin.onConfigChanged` already listens to — see `plugin/src/main/java/com/pbtracker/PbTrackerPlugin.java:200`) | Chat message fires at the kill moment (better for clip timing than the config write) |
| Collection log | `ChatMessage` "New item added to your collection log:" (requires the player's "Collection log - New addition notification" game setting ON) or script/varbit approach used by core screenshot plugin's `COLLECTION_LOG` case | Mirror core screenshot plugin logic |
| Achievement/quest/diary/CA | `ChatMessage` regexes: "Congratulations, you've completed", combat achievement messages; `WidgetLoaded` for quest-complete interface (`InterfaceID.QUESTSCROLL` etc.) | Again, core screenshot plugin has all these detections — port them |
| Level up | `StatChanged` or the level-up widget, behind a config toggle (fires often) | Optional, default off |
| Manual hotkey | `KeyManager` + `HotkeyListener` (see core screenshot plugin's hotkey) | "Clip last N seconds" |

**Key shortcut for the whole trigger layer:** RuneLite's **core screenshot
plugin** (`runelite-client/src/main/java/net/runelite/client/plugins/screenshot/ScreenshotPlugin.java`)
already detects almost this exact event list (PBs, levels, quests, collection
log, valuable drops, deaths...) to auto-screenshot. Port its detection code and
swap "save PNG" for "cut clip." Read that file first.

### Config surface (sketch)

- Buffer length (10–120 s, default 30), capture FPS (5–30, default 15),
  resolution cap, JPEG quality
- Post-roll seconds (default 10)
- Toggles per trigger + drop value threshold
- Format: AVI/MJPEG (v1), MP4 later
- Hotkey binding
- Output directory info / "open clips folder" link if feasible

### Project layout decision

Recommend a **separate plugin class in a separate package**
(`com.pbtracker.recorder.ClipRecorderPlugin` or its own sibling Gradle module)
rather than bolting onto `PbTrackerPlugin` — different concern, and if it goes
to the Plugin Hub it likely ships as its own plugin. It can still listen to the
same events the sync plugin uses. Note `plugin/build.gradle` +
`runelite-plugin.properties` currently describe only the PB sync plugin; a Hub
submission would need its own repo/properties anyway.

## Suggested first milestone (v1, sideload-able)

1. New plugin class + config; capture frames via `DrawManager` into a
   JPEG-compressed ring buffer on a background executor; log memory/timing.
2. Manual hotkey → dump buffer to MJPEG/AVI file in `~/.runelite/clips/`.
   Verify playback in VLC. This proves the whole pipeline.
3. Add trigger detection (start with PB chat message + valuable drop), with
   post-roll and debounce.
4. Add remaining triggers (collection log, quest/CA/diary), polish config.
5. Then: JCodec MP4 option, Discord-friendly size targets, possible PB-site
   upload integration, Plugin Hub submission (ask on Discord first).

## Verification notes

- `plugin/` builds with Gradle against `net.runelite:client` (see
  `plugin/build.gradle`); test in-client via RuneLite's developer mode /
  `PbTrackerPluginTest`-style main runner with an external plugin classpath.
- Watch client FPS impact with the buffer running — capture + JPEG encode must
  not stutter the client thread. Everything heavy goes on the executor.
- Test memory ceiling: worst-case config (120 s, 30 fps, high res) should
  either be clamped or warn.
