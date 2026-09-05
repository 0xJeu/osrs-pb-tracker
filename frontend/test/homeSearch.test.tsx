import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { HomeView } from '../src/components/HomeView';
import { PbTrackerApp } from '../src/components/PbTrackerApp';
import { api } from '../src/lib/api';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/bosses')) {
      return Promise.resolve(jsonResponse(['doom of mokhaiotl - delve 1', 'doom of mokhaiotl - delve 8+', 'zulrah']));
    }
    if (url.includes('/api/stats')) return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
    if (url.includes('/api/recent-syncs')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard-overview')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/players/blitzen')) return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    return Promise.resolve(jsonResponse([]));
  });
}

function homeProps(bosses: ComponentProps<typeof HomeView>['bosses']) {
  return {
    stats: { s: 'loaded' as const, data: { trackedPlayers: 0, personalBestRecords: 0 } },
    recentSyncs: { s: 'loaded' as const, data: [] },
    topBosses: { s: 'loaded' as const, data: [] },
    bosses,
    lookupPlayer: vi.fn(),
    goToBoss: vi.fn(),
  };
}

describe('home search box', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    api.resetForTesting();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('submitting a flat boss alias navigates to its first available timed record', async () => {
    render(<PbTrackerApp />);
    const input = await screen.findByPlaceholderText('Search players or bosses');
    fireEvent.change(input, { target: { value: 'doom' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(decodeURIComponent(window.location.pathname)).toBe('/boss/doom of mokhaiotl - delve 1');
    });
  });

  it('does not submit a recognized boss alias as a player while bosses are still loading', () => {
    const props = homeProps({ s: 'loading' });
    const view = render(<HomeView {...props} />);
    const input = view.container.querySelector('input')!;

    fireEvent.change(input, { target: { value: 'doom' } });
    fireEvent.submit(input.closest('form')!);

    expect(props.lookupPlayer).not.toHaveBeenCalled();
    expect(props.goToBoss).not.toHaveBeenCalled();
    expect(input).toHaveValue('doom');

    view.rerender(<HomeView {...props} bosses={{ s: 'loaded', data: ['doom of mokhaiotl - delve 8'] }} />);
    fireEvent.submit(input.closest('form')!);

    expect(props.lookupPlayer).not.toHaveBeenCalled();
    expect(props.goToBoss).toHaveBeenCalledWith('doom of mokhaiotl - delve 8');
  });

  it('does not submit a recognized boss alias as a player when the boss list fails to load', () => {
    const props = homeProps({ s: 'error' });
    const view = render(<HomeView {...props} />);
    const input = view.container.querySelector('input')!;

    fireEvent.change(input, { target: { value: 'doom' } });
    fireEvent.submit(input.closest('form')!);

    expect(props.lookupPlayer).not.toHaveBeenCalled();
    expect(props.goToBoss).not.toHaveBeenCalled();
    expect(input).toHaveValue('doom');
  });

  it.each([
    ['loading', { s: 'loading' as const }],
    ['failed', { s: 'error' as const }],
  ])('does not expose clickable player suggestions for an alias while boss metadata is %s', async (_label, bosses) => {
    vi.useFakeTimers();
    const searchAll = vi.spyOn(api, 'searchAll').mockResolvedValue([
      { type: 'player', value: 'doom', label: 'Doom' },
    ]);
    const props = homeProps(bosses);
    const view = render(<HomeView {...props} />);

    fireEvent.change(view.container.querySelector('input')!, { target: { value: 'doom' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(searchAll).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /player.*doom/i })).not.toBeInTheDocument();
    expect(props.lookupPlayer).not.toHaveBeenCalled();
  });
});
