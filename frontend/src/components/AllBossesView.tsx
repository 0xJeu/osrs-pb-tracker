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

function rowKeyAndIcon(row: CardRow): { key: string; iconKey: string } {
  return row.type === 'raid-base' ? { key: `base:${row.base}`, iconKey: row.base } : { key: row.key, iconKey: row.key };
}

/** Page header: title/subtitle on the left, search box on the right. */
function Header({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div className="pbt-lb-header">
      <div className="pbt-lb-header-left">
        <h2 className="pbt-display pbt-lb-title">Leaderboards</h2>
        <p className="pbt-lb-subtitle">Track PvM performance across all content.</p>
      </div>
      <label className="pbt-lb-search">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search bosses, raids..."
          aria-label="Search bosses, raids"
        />
      </label>
    </div>
  );
}

/** Section title + a decorative "View all" label (every section already shows everything - nothing to link to). */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="pbt-lb-section-head">
      <div className="pbt-lb-section-title">{title}</div>
      <span className="pbt-lb-viewall">View all <ChevronIcon /></span>
    </div>
  );
}

function RaidCard({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button type="button" className="pbt-lb-raid-card" key={key} onClick={() => onActivate(row)}>
      <span className="pbt-lb-raid-icon"><BossIcon boss={iconKey} /></span>
      <span className="pbt-lb-raid-text">
        <div className="pbt-lb-raid-name">{row.label}</div>
      </span>
      <span className="pbt-lb-raid-chevron"><ChevronIcon /></span>
    </button>
  );
}

function BossCard({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button type="button" className="pbt-lb-grid-card" key={key} onClick={() => onActivate(row)}>
      <span className="pbt-lb-grid-icon"><BossIcon boss={iconKey} /></span>
      <div className="pbt-lb-grid-name">{row.label}</div>
    </button>
  );
}

function SlayerPill({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key } = rowKeyAndIcon(row);
  return (
    <button type="button" className="pbt-lb-pill" key={key} onClick={() => onActivate(row)}>
      {row.label}
    </button>
  );
}

function MinigameCard({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button type="button" className="pbt-lb-scroll-card" key={key} onClick={() => onActivate(row)}>
      <span className="pbt-lb-scroll-icon"><BossIcon boss={iconKey} /></span>
      <div className="pbt-lb-scroll-name">{row.label}</div>
    </button>
  );
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

      <Header query={query} onQueryChange={setQuery} />

      {bosses.s === 'loading' && <div className="pbt-panel-state">Loading bosses...</div>}
      {bosses.s === 'error' && <div className="pbt-panel-state">Boss list unavailable.</div>}

      {isLoaded(bosses) && filteredGroups.length === 0 && (
        <div className="pbt-lb-empty">No bosses match "{query}".</div>
      )}

      {isLoaded(bosses) &&
        filteredGroups.map(({ group, rows }: { group: { category: Category }; rows: CardRow[] }) => (
          <div className="pbt-lb-section" key={group.category}>
            <SectionHeader title={group.category} />

            {group.category === 'Raids' && (
              <div className="pbt-lb-raids">
                {rows.map((row) => <RaidCard row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />)}
              </div>
            )}

            {group.category === 'Slayer Monsters' && (
              <div className="pbt-lb-pills">
                {rows.map((row) => <SlayerPill row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />)}
              </div>
            )}

            {group.category === 'Minigames & Challenges' && (
              <div className="pbt-lb-scroll-row">
                {rows.map((row) => <MinigameCard row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />)}
              </div>
            )}

            {(group.category === 'Bosses' || group.category === 'Other') && (
              <div className="pbt-lb-grid">
                {rows.map((row) => <BossCard row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />)}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
