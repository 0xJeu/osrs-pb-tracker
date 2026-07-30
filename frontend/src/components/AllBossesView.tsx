import { useMemo, useState } from 'react';
import { isLoaded, type LoadState } from '../lib/loadState';
import { bossMonogram } from '../lib/bossPetIcons';
import { useBossIconUrl } from '../lib/bossIcons';
import { basesFromGroups, getRaidModes, groupBosses, type Category } from '../lib/bossGroups';
import { matchesBossSearch } from '../lib/bossAliases';
import type { Route } from '../hooks/useRoute';

// Each boss's own bundled icon (see bossIcons.ts) - falls back to a text
// monogram for the rare boss with no icon recovered.
function BossIcon({ boss }: { boss: string }) {
  const url = useBossIconUrl(boss);
  return url ? <img src={url} alt="" loading="lazy" /> : <span>{bossMonogram(boss)}</span>;
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
      <path d="M12 13v3M9 20h6M9 20l.5-3.5M15 20l-.5-3.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function SwordsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M4 4l7 7M11 11L4 18M4 4v4M4 4h4" />
      <path d="M20 4l-7 7M13 11l7 7M20 4v4M20 4h-4" />
    </svg>
  );
}

function SkullIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3a7 7 0 0 0-7 7v3l-1 3h4l1 3h6l1-3h4l-1-3v-3a7 7 0 0 0-7-7Z" />
      <circle cx="9.5" cy="11.5" r="1.3" />
      <circle cx="14.5" cy="11.5" r="1.3" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l2.6 5.9 6.4.6-4.9 4.2 1.5 6.3L12 16.8 6.4 20l1.5-6.3-4.9-4.2 6.4-.6L12 3Z" />
    </svg>
  );
}

function DiamondIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M12 3l9 9-9 9-9-9 9-9Z" />
    </svg>
  );
}

const CATEGORY_ICON: Record<Category, () => JSX.Element> = {
  Raids: SwordsIcon,
  Bosses: SkullIcon,
  'Slayer Monsters': SkullIcon,
  'Minigames & Challenges': StarIcon,
  Other: DiamondIcon,
};

type CardRow =
  | { type: 'raid-base'; base: string; label: string }
  | { type: 'option'; key: string; label: string };

function rowMatchesQuery(row: CardRow, query: string): boolean {
  const target = row.type === 'raid-base' ? row.base : row.key;
  return matchesBossSearch(target, query) || row.label.toLowerCase().includes(query.toLowerCase());
}

function buildCardRows(group: ReturnType<typeof groupBosses>[number]): CardRow[] {
  const baseRows: CardRow[] = basesFromGroups(group.raidGroups ?? []).map((b) => ({
    type: 'raid-base',
    base: b.base,
    label: b.label,
  }));
  const itemRows: CardRow[] = (group.items ?? []).map((item) => ({
    type: 'option',
    key: item.key,
    label: item.label,
  }));
  return [...baseRows, ...itemRows].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A dedicated "browse every boss" page, distinct from the boss leaderboard
 * page itself - previously the only way in was the top nav's "Leaderboards"
 * button, which just reopened whatever boss you'd last looked at (or a
 * default), with no way to see the full list and pick a different one.
 */
export function AllBossesView({
  bosses,
  goToBoss,
  navigate,
}: {
  bosses: LoadState<string[]>;
  goToBoss: (boss: string) => void;
  navigate: (route: Route) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => (isLoaded(bosses) ? groupBosses(bosses.data) : []), [bosses]);

  const filteredGroups = useMemo(() => {
    const q = query.trim();
    if (!q) return groups.map((group) => ({ group, rows: buildCardRows(group) }));
    return groups
      .map((group) => ({ group, rows: buildCardRows(group).filter((row) => rowMatchesQuery(row, q)) }))
      .filter(({ rows }) => rows.length > 0);
  }, [groups, query]);

  const activateRow = (row: CardRow) => {
    if (row.type === 'raid-base') {
      const firstVariant = isLoaded(bosses) ? getRaidModes(bosses.data, row.base)[0]?.variants[0]?.key : undefined;
      if (firstVariant) goToBoss(firstVariant);
    } else {
      goToBoss(row.key);
    }
  };

  return (
    <div className="pbt-section pbt-lb-page" style={{ paddingTop: 40 }}>
      <div className="pbt-crumbs">
        <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> / Leaderboards
      </div>

      <div className="pbt-lb-header">
        <div className="pbt-lb-header-left">
          <span className="pbt-lb-header-icon"><TrophyIcon /></span>
          <div>
            <h2 className="pbt-display pbt-lb-title">Leaderboards</h2>
            <p className="pbt-lb-subtitle">Track, compare, and find your next personal-best leaderboard.</p>
          </div>
        </div>
        <label className="pbt-lb-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search bosses, raids, minigames..."
            aria-label="Search bosses, raids, minigames"
          />
        </label>
      </div>

      {bosses.s === 'loading' && <div className="pbt-panel-state">Loading bosses...</div>}
      {bosses.s === 'error' && <div className="pbt-panel-state">Boss list unavailable.</div>}

      {isLoaded(bosses) && filteredGroups.length === 0 && (
        <div className="pbt-lb-panel"><div className="pbt-lb-empty">No bosses match "{query}".</div></div>
      )}

      {isLoaded(bosses) &&
        filteredGroups.map(({ group, rows }) => {
          const Icon = CATEGORY_ICON[group.category];
          const isRaidsPanel = group.category === 'Raids';

          return (
            <div className="pbt-lb-panel" key={group.category}>
              <div className="pbt-lb-panel-head">
                <div className="pbt-lb-panel-title"><Icon /> {group.category}</div>
              </div>

              {isRaidsPanel ? (
                <div className="pbt-lb-raids">
                  {rows.map((row) => {
                    const key = row.type === 'raid-base' ? row.base : row.key;
                    const iconKey = row.type === 'raid-base' ? row.base : row.key;
                    return (
                      <button type="button" className="pbt-lb-raid-card" key={key} onClick={() => activateRow(row)}>
                        <span className="pbt-lb-raid-icon"><BossIcon boss={iconKey} /></span>
                        <span className="pbt-lb-raid-text">
                          <div className="pbt-lb-raid-name">{row.label}</div>
                        </span>
                        <span className="pbt-lb-raid-chevron"><ChevronIcon /></span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="pbt-lb-grid">
                  {rows.map((row) => {
                    const key = row.type === 'raid-base' ? `base:${row.base}` : row.key;
                    const iconKey = row.type === 'raid-base' ? row.base : row.key;
                    return (
                      <button type="button" className="pbt-lb-grid-card" key={key} onClick={() => activateRow(row)}>
                        <span className="pbt-lb-grid-icon"><BossIcon boss={iconKey} /></span>
                        <div className="pbt-lb-grid-name">{row.label}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
