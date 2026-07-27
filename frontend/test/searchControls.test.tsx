import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PbTrackerApp } from '../src/components/PbTrackerApp';
import { api } from '../src/lib/api';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface PendingSearch {
  query: string;
  signal?: AbortSignal | null;
  resolve: (response: Response) => void;
}

describe('universal-search request lifecycle', () => {
  let pendingSearches: PendingSearch[];

  beforeEach(() => {
    pendingSearches = [];
    window.history.pushState({}, '', '/');
    api.resetForTesting();
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/bosses')) return Promise.resolve(jsonResponse(['zulrah', 'vorkath']));
      if (url.includes('/api/stats')) {
        return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
      }
      if (url.includes('/api/recent-syncs') || url.includes('/api/leaderboard-overview')) {
        return Promise.resolve(jsonResponse([]));
      }
      if (url.includes('/api/search/all')) {
        return new Promise<Response>((resolve) => {
          pendingSearches.push({
            query: new URL(url, 'https://example.test').searchParams.get('q') ?? '',
            signal: init?.signal,
            resolve,
          });
        });
      }
      return Promise.resolve(jsonResponse([]));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('aborts a superseded request and ignores its late response', async () => {
    render(<PbTrackerApp />);
    const input = screen.getByRole('textbox', { name: 'Search players or bosses' });

    fireEvent.change(input, { target: { value: 'blit' } });
    await waitFor(() => expect(pendingSearches).toHaveLength(1), { timeout: 1_000 });

    fireEvent.change(input, { target: { value: 'blitz' } });
    expect(pendingSearches[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(pendingSearches).toHaveLength(2), { timeout: 1_000 });

    pendingSearches[1].resolve(jsonResponse([{ type: 'player', value: 'Blitzen' }]));
    expect(await screen.findByRole('button', { name: /player\s+Blitzen/i })).toBeInTheDocument();

    pendingSearches[0].resolve(jsonResponse([{ type: 'player', value: 'Blit Old' }]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('Blit Old')).not.toBeInTheDocument();
  });

  it('cancels the pending debounce when the user leaves Home', async () => {
    render(<PbTrackerApp />);
    const input = screen.getByRole('textbox', { name: 'Search players or bosses' });

    fireEvent.change(input, { target: { value: 'blitzen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Setup' }));

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(pendingSearches).toHaveLength(0);
  });
});
