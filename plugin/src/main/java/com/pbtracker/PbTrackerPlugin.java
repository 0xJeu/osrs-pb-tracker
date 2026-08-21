package com.pbtracker;

import com.google.inject.Provides;
import lombok.extern.slf4j.Slf4j;
import net.runelite.api.Client;
import net.runelite.api.GameState;
import net.runelite.api.events.GameStateChanged;
import net.runelite.api.events.GameTick;
import net.runelite.api.events.WidgetLoaded;
import net.runelite.api.gameval.InterfaceID;
import net.runelite.api.widgets.Widget;
import net.runelite.client.config.ConfigManager;
import net.runelite.client.eventbus.Subscribe;
import net.runelite.client.events.ConfigChanged;
import net.runelite.client.plugins.Plugin;
import net.runelite.client.plugins.PluginDescriptor;
import net.runelite.client.util.Text;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.Response;

import javax.inject.Inject;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads boss personal best times that RuneLite's built-in Chat Commands
 * plugin already tracks (RSProfile config group "personalbest") and syncs
 * them to a custom backend so they can be shown on a public leaderboard
 * website, looked up by player name.
 * <p>
 * Three sync paths:
 *  - Live: on every ConfigChanged event in the "personalbest" group (i.e.
 *    the moment you get a new PB), we push just that one value.
 *  - Bulk: on login (and via the "Sync all PBs now" checkbox in the plugin's
 *    own Configuration panel) we ask ConfigManager for every key that
 *    actually exists under the "personalbest" group for this account and
 *    push all of them, rather than matching against a hardcoded boss name
 *    list. This is what fixes bosses silently going missing due to a name
 *    not matching RuneLite's internal key exactly.
 *  - Adventure Log: RuneLite's core Chat Commands plugin captures data from
 *    your Adventure Log's Counters page too, but it collapses "fastest room
 *    time" records into the same key as full-completion times, which is
 *    ambiguous. We separately read that same in-game page ourselves so we
 *    can label "fastest room" times distinctly (e.g. "Theatre of Blood -
 *    Fastest Room") instead of losing that distinction.
 */
@Slf4j
@PluginDescriptor(
	name = "PB Tracker Sync",
	description = "Reads your boss personal best times and syncs them to a custom PB leaderboard website",
	tags = {"pb", "personal best", "boss", "records", "leaderboard"}
)
public class PbTrackerPlugin extends Plugin
{
	private static final String CONFIG_GROUP = "personalbest";

	// Our own plugin's config group (matches @ConfigGroup on PbTrackerConfig) -
	// used to persist a per-install secret that isn't exposed as a visible
	// setting.
	private static final String SETTINGS_GROUP = "pbtracker";
	private static final String INSTALL_SECRET_KEY = "installSecret";
	private static final String SYNC_NOW_KEY = "syncNow";
	private static final String SYNC_STATUS_KEY = "syncStatus";
	private static final DateTimeFormatter TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

	// Matches any "Fastest <descriptor>: <value>" line on the Adventure Log
	// Counters page, e.g. "Fastest kill: 3:34", "Fastest run: -",
	// "Fastest Room time - (Team size: 3 player): 18:34". The descriptor is
	// classified afterwards rather than baked into the regex, since the exact
	// wording (kill/run/Room time/Overall time/Wave time, plus inconsistent
	// parenthesis usage) varies more than expected.
	private static final Pattern RECORD_PATTERN = Pattern.compile(
		"^Fastest (?<descriptor>.+): (?<value>-|[0-9:]+(?:\\.[0-9]+)?)$"
	);

	// A few activities are stored under a different internal name in
	// RuneLite's raw "personalbest" config than the heading the Adventure Log
	// actually displays for them, so they'd otherwise show up as duplicate
	// rows under two different labels for the same record. Live/bulk sync
	// skips the raw key and waits for the Adventure Log parser to supply the
	// properly-labelled version instead - mapped here to the heading text so
	// we can tell whether that's actually happened yet, and nudge the user to
	// open the Adventure Log if not (see syncedAdventureLogHeadings below).
	private static final Map<String, String> KNOWN_DUPLICATE_RAW_KEYS = new HashMap<>();
	static
	{
		KNOWN_DUPLICATE_RAW_KEYS.put("tztok-jad", "TzHaar Fight Cave");
		KNOWN_DUPLICATE_RAW_KEYS.put("tzkal-zuk", "Inferno");
		KNOWN_DUPLICATE_RAW_KEYS.put("sol heredit", "Fortis Colosseum");
		KNOWN_DUPLICATE_RAW_KEYS.put("hueycoatl", "The Hueycoatl");
		KNOWN_DUPLICATE_RAW_KEYS.put("gauntlet", "The Gauntlet");
		KNOWN_DUPLICATE_RAW_KEYS.put("corrupted gauntlet", "The Corrupted Gauntlet");
		KNOWN_DUPLICATE_RAW_KEYS.put("nightmare", "The Nightmare");
	}

	@Inject
	private Client client;

	@Inject
	private PbTrackerConfig config;

	@Inject
	private ConfigManager configManager;

	@Inject
	private SyncClient syncClient;

	@Inject
	private ScheduledExecutorService executor;

	private String accountHash;
	private String installSecret;
	private boolean journalScrollLoaded;

	// Adventure Log headings (lowercased) we've successfully parsed a record
	// for this session - lets us tell whether a KNOWN_DUPLICATE_RAW_KEYS boss
	// has actually been synced yet, so we can nudge the user instead of
	// silently dropping it forever.
	private final Set<String> syncedAdventureLogHeadings = new LinkedHashSet<>();

	@Provides
	PbTrackerConfig provideConfig(ConfigManager configManager)
	{
		return configManager.getConfig(PbTrackerConfig.class);
	}

	@Override
	protected void startUp()
	{
		installSecret = getOrCreateInstallSecret();
	}

	/**
	 * RuneLite gives plugins no way to prove account identity to a
	 * third-party server, so this doesn't authenticate the player - it's a
	 * per-install credential the backend uses to bind (on first sync) and
	 * verify (on every sync after) that updates for a given account are
	 * coming from the same install, rather than accepting anyone who guesses
	 * or observes that account's hash.
	 */
	private String getOrCreateInstallSecret()
	{
		String existing = configManager.getConfiguration(SETTINGS_GROUP, INSTALL_SECRET_KEY);
		if (existing != null && !existing.isEmpty())
		{
			return existing;
		}

		byte[] randomBytes = new byte[32];
		new SecureRandom().nextBytes(randomBytes);
		String generated = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
		configManager.setConfiguration(SETTINGS_GROUP, INSTALL_SECRET_KEY, generated);
		return generated;
	}

	@Override
	protected void shutDown()
	{
	}

	/**
	 * Everything the plugin has to say lives in its Configuration panel
	 * rather than a separate sidebar panel - this just persists the given
	 * text as the read-only-ish "Last sync status" field.
	 */
	private void setStatus(String text)
	{
		configManager.setConfiguration(SETTINGS_GROUP, SYNC_STATUS_KEY, text);
	}

	@Subscribe
	public void onGameStateChanged(GameStateChanged event)
	{
		if (event.getGameState() == GameState.LOGGED_IN)
		{
			accountHash = String.valueOf(client.getAccountHash());

			if (config.syncOnLogin())
			{
				// give the client a few seconds to settle before bulk syncing
				executor.schedule(this::syncAll, 5, TimeUnit.SECONDS);
			}
		}
	}

	@Subscribe
	public void onConfigChanged(ConfigChanged event)
	{
		if (SETTINGS_GROUP.equals(event.getGroup()))
		{
			// Note: we deliberately do NOT reset this checkbox back to false
			// programmatically after triggering a sync. RuneLite's config
			// panel doesn't repaint from a programmatic change until the
			// panel is closed and reopened, so resetting it here made the
			// box look "stuck" checked even though the stored value was
			// already false. Leaving it checked keeps the displayed state
			// truthful - you'd need to manually uncheck it to trigger again.
			if (SYNC_NOW_KEY.equals(event.getKey()) && shouldTriggerSyncNow(event.getNewValue()))
			{
				executor.execute(this::syncAll);
			}
			return;
		}

		if (!config.autoSync() || !CONFIG_GROUP.equals(event.getGroup()))
		{
			return;
		}

		String boss = event.getKey();
		String rawValue = event.getNewValue();

		if (rawValue == null)
		{
			return;
		}

		if (looksLikeRaidVariant(boss))
		{
			// Raid/team-size records (e.g. "chambers of xeric 2 players") get
			// synced with proper Room/Overall labels from the Adventure Log
			// parser instead - skip the raw, differently-named version here
			// so the two don't show up as duplicate entries on the site.
			String heading = KNOWN_DUPLICATE_RAW_KEYS.get(boss.toLowerCase());
			if (heading != null && !syncedAdventureLogHeadings.contains(heading.toLowerCase()))
			{
				setStatus("New " + heading + " PB detected but not synced yet - open Adventure Log > Counters once to sync it.");
			}
			return;
		}

		try
		{
			double seconds = Double.parseDouble(rawValue);
			Map<String, Double> single = new HashMap<>();
			single.put(boss, seconds);
			syncPbs(single);
		}
		catch (NumberFormatException ex)
		{
			log.debug("Ignoring non-numeric personalbest value for {}: {}", boss, rawValue);
		}
	}

	/**
	 * True for any raw personalbest key that's better sourced from the
	 * Adventure Log parser instead - either because it's a raid/team-size
	 * variant (e.g. "chambers of xeric 2 players", "theatre of blood entry
	 * mode solo"), which gets proper Room/Overall labels there, or because
	 * it's one of the few activities stored under a different internal name
	 * than the Adventure Log's own heading for it.
	 */
	private static boolean looksLikeRaidVariant(String key)
	{
		String lower = key.toLowerCase();
		if (KNOWN_DUPLICATE_RAW_KEYS.containsKey(lower))
		{
			return true;
		}
		return lower.matches(".*\\d.*") || lower.endsWith(" solo") || lower.contains(" mode");
	}

	static boolean shouldTriggerSyncNow(String newValue)
	{
		return Boolean.parseBoolean(newValue);
	}

	@Subscribe
	public void onWidgetLoaded(WidgetLoaded event)
	{
		if (event.getGroupId() == InterfaceID.JOURNALSCROLL)
		{
			// Adventure Log "Counters" page just opened - the actual widget text
			// isn't populated until the following game tick.
			journalScrollLoaded = true;
		}
	}

	@Subscribe
	public void onGameTick(GameTick event)
	{
		if (!journalScrollLoaded)
		{
			return;
		}
		journalScrollLoaded = false;

		Widget parent = client.getWidget(InterfaceID.Journalscroll.TEXTLAYER);
		if (parent == null)
		{
			return;
		}

		Widget[] children = parent.getStaticChildren();
		if (children == null || children.length == 0)
		{
			return;
		}

		// Raw widget text, one entry per line as OSRS renders it.
		List<String> rawLines = new ArrayList<>(children.length);
		for (Widget child : children)
		{
			rawLines.add(Text.removeTags(child.getText()));
		}

		// Long lines wrap: a label ending in ":" with nothing after it means
		// the actual value is sitting by itself on the next line. Merge those
		// back into a single "label: value" line before parsing.
		List<String> lines = new ArrayList<>();
		for (int i = 0; i < rawLines.size(); i++)
		{
			String line = rawLines.get(i);
			if (line.endsWith(":") && i + 1 < rawLines.size() && isBareValue(rawLines.get(i + 1)))
			{
				lines.add(line + " " + rawLines.get(i + 1));
				i++;
			}
			else
			{
				lines.add(line);
			}
		}

		Map<String, Double> pbs = new HashMap<>();
		String currentHeading = null;

		for (String line : lines)
		{
			if (line.isEmpty())
			{
				currentHeading = null;
				continue;
			}

			Matcher matcher = RECORD_PATTERN.matcher(line);
			if (!matcher.find())
			{
				// Not a record line - treat it as the heading (activity/boss
				// name) that the following record lines belong to.
				currentHeading = line;
				continue;
			}

			if (currentHeading == null)
			{
				continue;
			}

			String descriptor = matcher.group("descriptor");
			String valueStr = matcher.group("value");
			if ("-".equals(valueStr))
			{
				// No time recorded for this stat yet.
				continue;
			}

			Double seconds = parseTimeString(valueStr);
			if (seconds == null)
			{
				continue;
			}

			pbs.put(buildKey(currentHeading, descriptor), seconds);
			syncedAdventureLogHeadings.add(currentHeading.toLowerCase());
		}

		if (!pbs.isEmpty())
		{
			log.debug("Parsed {} PB(s) from Adventure Log Counters page", pbs.size());
			syncPbs(pbs);
		}
	}

	private static boolean isBareValue(String line)
	{
		return line.equals("-") || line.matches("[0-9:]+(?:\\.[0-9]+)?");
	}

	/**
	 * Turns a heading ("Theatre of Blood") and a raw descriptor ("Room time -
	 * (Team size: 3 player)") into a clean, unambiguous sync key like
	 * "Theatre of Blood - Fastest Room (3 player)". Bare "kill"/"run" (no
	 * team size, single-stat bosses) just use the heading as-is.
	 */
	private static String buildKey(String heading, String descriptor)
	{
		if (descriptor.equals("kill") || descriptor.equals("run"))
		{
			return heading;
		}

		String label;
		String remainder;
		if (descriptor.startsWith("Room time"))
		{
			label = "Fastest Room";
			remainder = descriptor.substring("Room time".length());
		}
		else if (descriptor.startsWith("Wave time"))
		{
			label = "Fastest Wave";
			remainder = descriptor.substring("Wave time".length());
		}
		else if (descriptor.startsWith("Overall time"))
		{
			label = "Fastest Overall";
			remainder = descriptor.substring("Overall time".length());
		}
		else if (descriptor.startsWith("kill"))
		{
			label = "Fastest Overall";
			remainder = descriptor.substring("kill".length());
		}
		else if (descriptor.startsWith("run"))
		{
			label = "Fastest Overall";
			remainder = descriptor.substring("run".length());
		}
		else
		{
			// Unrecognized shape - keep the raw descriptor rather than
			// silently dropping the record.
			label = descriptor;
			remainder = "";
		}

		String detail = remainder
			.replace("- (Team size:", "")
			.replaceAll("[()]", "")
			.trim();

		return heading + " - " + label + (detail.isEmpty() ? "" : " (" + detail + ")");
	}

	private static Double parseTimeString(String timeString)
	{
		try
		{
			String[] parts = timeString.split(":");
			if (parts.length == 2)
			{
				return Integer.parseInt(parts[0]) * 60 + Double.parseDouble(parts[1]);
			}
			else if (parts.length == 3)
			{
				return Integer.parseInt(parts[0]) * 3600 + Integer.parseInt(parts[1]) * 60 + Double.parseDouble(parts[2]);
			}
			return Double.parseDouble(timeString);
		}
		catch (NumberFormatException ex)
		{
			return null;
		}
	}

	private void syncAll()
	{
		String profileKey = configManager.getRSProfileKey();
		if (profileKey == null)
		{
			setStatus("Not logged in yet - log in, then try again.");
			return;
		}

		List<String> bossKeys = configManager.getRSProfileConfigurationKeys(CONFIG_GROUP, profileKey, "");

		Map<String, Double> raw = new HashMap<>();
		for (String boss : bossKeys)
		{
			Double seconds = configManager.getRSProfileConfiguration(CONFIG_GROUP, boss, double.class);
			if (seconds != null)
			{
				raw.put(boss, seconds);
			}
		}

		// Skip raid/team-size variants (e.g. "chambers of xeric 2 players") -
		// those are synced with proper Room/Overall labels by the Adventure
		// Log parser instead, so sending the raw version here would just
		// create a duplicate, differently-named row for the same record.
		Map<String, Double> pbs = new HashMap<>();
		for (Map.Entry<String, Double> entry : raw.entrySet())
		{
			String key = entry.getKey();
			if (!looksLikeRaidVariant(key))
			{
				pbs.put(key, entry.getValue());
			}
		}

		String unsyncedNote = buildUnsyncedDuplicatesNote(raw);

		if (pbs.isEmpty())
		{
			setStatus(unsyncedNote != null
				? "No personal bests found yet. " + unsyncedNote
				: "No personal bests found yet - go kill something!");
			return;
		}

		setStatus("Syncing " + pbs.size() + " PB(s)...");
		syncPbs(pbs, unsyncedNote);
	}

	/**
	 * Jad/Zuk/Colosseum/Hueycoatl are deliberately excluded from live and bulk
	 * sync (see looksLikeRaidVariant) so the Adventure Log parser can supply
	 * them with a properly-labelled name instead. But that parser only runs
	 * when the player manually opens the in-game Adventure Log Counters page
	 * - if they never do, those records would otherwise just never sync.
	 * Returns a status note listing any such records that are sitting unsynced
	 * right now, or null if there's nothing to flag.
	 */
	private String buildUnsyncedDuplicatesNote(Map<String, Double> raw)
	{
		List<String> unsynced = new ArrayList<>();
		for (Map.Entry<String, String> entry : KNOWN_DUPLICATE_RAW_KEYS.entrySet())
		{
			String heading = entry.getValue();
			if (raw.containsKey(entry.getKey()) && !syncedAdventureLogHeadings.contains(heading.toLowerCase()))
			{
				unsynced.add(heading);
			}
		}

		if (unsynced.isEmpty())
		{
			return null;
		}

		return "Not synced yet: " + String.join(", ", unsynced) + " - open Adventure Log > Counters once to sync.";
	}

	private void syncPbs(Map<String, Double> pbs)
	{
		syncPbs(pbs, null);
	}

	private void syncPbs(Map<String, Double> pbs, String statusNote)
	{
		if (client.getLocalPlayer() == null || client.getLocalPlayer().getName() == null)
		{
			return;
		}

		String name = client.getLocalPlayer().getName();
		String hash = accountHash != null ? accountHash : String.valueOf(client.getAccountHash());
		String suffix = statusNote != null ? " " + statusNote : "";

		syncClient.sync(hash, name, pbs, installSecret, new Callback()
		{
			@Override
			public void onFailure(Call call, IOException e)
			{
				log.warn("PB sync failed", e);
				setStatus("Sync failed: " + e.getMessage());
			}

			@Override
			public void onResponse(Call call, Response response)
			{
				try
				{
					if (response.isSuccessful())
					{
						setStatus("Last updated: " + TIMESTAMP_FORMAT.format(LocalDateTime.now()) + suffix);
					}
					else if (response.code() == 409)
					{
						setStatus("Sync rejected: this account is already synced from a different install.");
					}
					else
					{
						setStatus("Server responded with error " + response.code());
					}
				}
				finally
				{
					response.close();
				}
			}
		});
	}
}
