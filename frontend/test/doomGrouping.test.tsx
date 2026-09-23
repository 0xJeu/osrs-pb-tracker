import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BossView } from '../src/components/BossView';
import { compactAliasSuggestions } from '../src/hooks/useSearchSuggestions';
import { bossIconFile } from '../src/lib/bossIcons';

const PARTIAL_DOOM = [
  'doom of mokhaiotl - delve 3',
  'doom of mokhaiotl - delve 1',
  'doom of mokhaiotl - delve 4',
  'doom of mokhaiotl - delve 2',
];

function renderBossView(bosses: string[], selectedBoss: string) {
  return render(
    <BossView
      titleParts={{ primary: 'Doom Of Mokhaiotl', secondary: 'Delve 1' }}
      bosses={{ s: 'loaded', data: bosses }}
      selectedBoss={selectedBoss}
      goToBoss={vi.fn()}
      navigate={vi.fn()}
      leaderboard={{ s: 'loaded', data: { rows: [], total: 0, limit: 50, offset: 0 } }}
      setLeaderboardOffset={vi.fn()}
      rows={[]}
      lookupPlayer={vi.fn()}
    />
  );
}

function pickerLabels(container: HTMLElement): string[] {
  const picker = container.querySelector('.raid-variant-switcher') as HTMLElement;
  return within(picker).getAllByRole('button').map((button) => button.textContent ?? '');
}

afterEach(cleanup);

describe('Doom of Mokhaiotl boss page', () => {
  it('offers only the delve tiers that have records, in delve order', () => {
    const { container } = renderBossView([...PARTIAL_DOOM, 'zulrah'], 'doom of mokhaiotl - delve 2');
    expect(pickerLabels(container)).toEqual(['Delve 1', 'Delve 2', 'Delve 3', 'Delve 4']);
    expect(container.querySelector('.raid-variant-button.active')).toHaveTextContent('Delve 2');
  });

  it('still shows the selected tier when no Doom records exist yet', () => {
    const { container } = renderBossView(['zulrah'], 'doom of mokhaiotl - delve 1');
    expect(pickerLabels(container)).toEqual(['Delve 1']);
    expect(screen.getByText('No synced PBs for this boss yet.')).toBeInTheDocument();
  });
});

describe('Doom of Mokhaiotl icon', () => {
  it('resolves the grouped entry and every delve tier to the bundled icon', () => {
    const keys = ['doom of mokhaiotl', ...['1', '2', '3', '4', '5', '6', '7', '8', '8+'].map((t) => `Doom of Mokhaiotl - Delve ${t}`)];
    for (const key of keys) expect(bossIconFile(key)).toBe('/boss-icons/doom_of_mokhaiotl.png');
    expect(existsSync(resolve(__dirname, '../public/boss-icons/doom_of_mokhaiotl.png'))).toBe(true);
  });
});

describe('Doom of Mokhaiotl search alias', () => {
  it('collapses to a single suggestion that opens the lowest synced delve', () => {
    expect(compactAliasSuggestions('doom', [...PARTIAL_DOOM, 'zulrah'])).toEqual([
      { type: 'boss', value: 'doom of mokhaiotl - delve 1', label: 'Doom Of Mokhaiotl' },
    ]);
  });

  it('has nothing to suggest when no Doom records exist yet', () => {
    expect(compactAliasSuggestions('doom', ['zulrah'])).toBeUndefined();
  });

  it('keeps the mode suffix for multi-mode raids', () => {
    const labels = compactAliasSuggestions('tob', [
      'theatre of blood - fastest overall (3 player)',
      'theatre of blood - hard - fastest overall (4 player hard mode)',
    ])?.map((s) => s.label);
    expect(labels).toEqual(['Theatre Of Blood — Normal', 'Theatre Of Blood — Hard']);
  });
});
