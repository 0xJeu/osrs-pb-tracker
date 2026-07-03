package com.pbtracker;

import com.google.gson.Gson;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;

import javax.inject.Inject;
import java.util.Map;

/**
 * Thin wrapper around RuneLite's shared OkHttpClient that POSTs a player's
 * personal bests to the PB tracker backend.
 */
class SyncClient
{
	private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");

	private final OkHttpClient httpClient;
	private final Gson gson;
	private final PbTrackerConfig config;

	@Inject
	SyncClient(OkHttpClient httpClient, Gson gson, PbTrackerConfig config)
	{
		this.httpClient = httpClient;
		this.gson = gson;
		this.config = config;
	}

	void sync(String accountHash, String displayName, Map<String, Double> pbs, String installSecret, Callback callback)
	{
		if (pbs.isEmpty())
		{
			return;
		}

		SyncPayload payload = new SyncPayload(accountHash, displayName, pbs, installSecret);
		String json = gson.toJson(payload);

		String base = config.apiBaseUrl() == null ? "" : config.apiBaseUrl().replaceAll("/+$", "");
		String url = base + "/api/sync";

		Request request = new Request.Builder()
			.url(url)
			.post(RequestBody.create(JSON, json))
			.build();

		httpClient.newCall(request).enqueue(callback);
	}

	private static class SyncPayload
	{
		final String accountHash;
		final String displayName;
		final Map<String, Double> pbs;
		final String installSecret;

		SyncPayload(String accountHash, String displayName, Map<String, Double> pbs, String installSecret)
		{
			this.accountHash = accountHash;
			this.displayName = displayName;
			this.pbs = pbs;
			this.installSecret = installSecret;
		}
	}
}
