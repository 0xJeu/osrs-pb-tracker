package com.pbtracker;

import net.runelite.client.config.Config;
import net.runelite.client.config.ConfigGroup;
import net.runelite.client.config.ConfigItem;

@ConfigGroup("pbtracker")
public interface PbTrackerConfig extends Config
{
	@ConfigItem(
		keyName = "apiBaseUrl",
		name = "API base URL",
		description = "Base URL of your PB tracker backend, e.g. https://osrs-pb-tracker-backend.vercel.app",
		position = 0
	)
	default String apiBaseUrl()
	{
		return "https://osrs-pb-tracker-backend.vercel.app";
	}

	@ConfigItem(
		keyName = "autoSync",
		name = "Auto-sync new PBs",
		description = "Automatically send a PB to the server the moment RuneLite records a new one",
		position = 1
	)
	default boolean autoSync()
	{
		return true;
	}

	@ConfigItem(
		keyName = "syncOnLogin",
		name = "Sync all PBs on login",
		description = "Bulk-upload every known PB shortly after logging in",
		position = 2
	)
	default boolean syncOnLogin()
	{
		return true;
	}

	@ConfigItem(
		keyName = "syncNow",
		name = "Sync all PBs now",
		description = "Check to trigger an immediate bulk sync. Uncheck and check again to trigger another one.",
		position = 3
	)
	default boolean syncNow()
	{
		return false;
	}

	@ConfigItem(
		keyName = "syncStatus",
		name = "Last synced",
		description = "For display only - RuneLite doesn't support a true read-only field here, "
			+ "so this is technically editable, but it's overwritten on every sync and typing in "
			+ "it has no other effect.",
		position = 4
	)
	default String syncStatus()
	{
		return "Never";
	}
}
