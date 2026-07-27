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

describe('player lookup lifecycle', () => {
  let resolvePlayer: (response: Response) => void;
  let playerRequestStarted: boolean;

  beforeEach(() => {
    playerRequestStarted = false;
    window.history.pushState({}, '', '/player/old-name');
    api.resetForTesting();
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/players/')) {
        playerRequestStarted = true;
        return new Promise<Response>((resolve) => {
          resolvePlayer = resolve;
        });
      }
      if (url.includes('/api/bosses')) return Promise.resolve(jsonResponse(['zulrah']));
      if (url.includes('/api/stats')) {
        return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
      }
      if (url.includes('/api/recent-syncs') || url.includes('/api/leaderboard-overview')) {
        return Promise.resolve(jsonResponse([]));
      }
      return Promise.resolve(jsonResponse([]));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('ignores a late player result after navigating away', async () => {
    render(<PbTrackerApp />);
    await waitFor(() => expect(playerRequestStarted).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(window.location.pathname).toBe('/');

    resolvePlayer(jsonResponse({
      id: 1,
      displayName: 'Canonical Name',
      updatedAt: '2026-07-26T00:00:00.000Z',
      pbs: [],
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('heading', { name: 'Find your next personal best.' })).toBeInTheDocument();
  });
});
