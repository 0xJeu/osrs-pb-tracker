import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PbTrackerApp } from '../src/components/PbTrackerApp';
import { api } from '../src/lib/api';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/bosses')) return Promise.resolve(jsonResponse(['zulrah']));
    if (url.includes('/api/stats')) return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
    if (url.includes('/api/recent-syncs')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard-overview')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/players/blitzen')) return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    return Promise.resolve(jsonResponse([]));
  });
}

describe('home search box', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    api.resetForTesting();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submitting a player name navigates to that player and clears the search box', async () => {
    render(<PbTrackerApp />);
    const input = await screen.findByPlaceholderText('Search players or bosses');
    fireEvent.change(input, { target: { value: 'Blitzen' } });
    const form = input.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(window.location.pathname).toBe('/player/Blitzen'));
  });
});
