import { useMemo, useState } from 'react';
import '../tailwind.css';
import { isLoaded, type LoadState } from '../lib/loadState';
import { bossMonogram } from '../lib/bossPetIcons';
import { useBossIconUrl } from '../lib/bossIcons';
import { basesFromGroups, getRaidModes, groupBosses, type Category } from '../lib/bossGroups';
import { matchesBossSearch } from '../lib/bossAliases';
import type { Route } from '../hooks/useRoute';
import type { LeaderboardRow } from '../lib/api';

// Each boss's own bundled icon (see bossIcons.ts) - falls back to a text
// monogram for the rare boss with no icon recovered.
function BossIcon({ boss, className }: { boss: string; className?: string }) {
  const url = useBossIconUrl(boss);
  return url ? (
    <img src={url} alt="" loading="lazy" className={`h-full w-full object-contain ${className ?? ''}`} />
  ) : (
    <span className={className}>{bossMonogram(boss)}</span>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-[#AAB2C0]">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
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

/** boss -> its top-ranked player, from the real /api/leaderboard-overview data (not fabricated). */
type TopBossesOverview = Array<{ boss: string; leader: LeaderboardRow | null }>;

function findLeader(overview: TopBossesOverview | undefined, target: string): LeaderboardRow | null | undefined {
  if (!overview) return undefined;
  const t = target.trim().toLowerCase();
  const hit = overview.find((o) => {
    const b = o.boss.trim().toLowerCase();
    return b.startsWith(t) || t.startsWith(b);
  });
  return hit?.leader;
}

function PageContainer({ children }: { children: React.ReactNode }) {
  // Breaks out of the site's own outer page padding (see theme-osrs-preview.css's
  // .pbt-page) so this container's own max-width/padding below is the only
  // spacing in effect, matching the spec exactly regardless of what page
  // shell it's mounted inside on this site.
  return (
    <div className="-mx-10 -mt-10 bg-[#0F1115] px-6 pb-16 pt-6 text-white">
      <div className="mx-auto max-w-[1200px]">{children}</div>
    </div>
  );
}

function Header({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-6">
      <div>
        <h2 className="m-0 text-3xl font-bold text-white">Leaderboards</h2>
        <p className="mt-1 text-sm text-[#AAB2C0]">Track PvM performance across all content</p>
      </div>
      <label className="flex h-10 w-[300px] items-center gap-2 rounded-lg border border-white/5 bg-[#1F2430] px-3">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search bosses, raids..."
          aria-label="Search bosses, raids"
          className="w-full bg-transparent text-sm text-white placeholder:text-[#AAB2C0] focus:outline-none"
        />
      </label>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <span className="flex items-center gap-1 text-sm text-[#D4AF37]">
        View all <ArrowIcon className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

function RaidCard({ row, leader, onActivate }: { row: CardRow; leader: LeaderboardRow | null | undefined; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button
      type="button"
      key={key}
      onClick={() => onActivate(row)}
      className="flex h-[100px] flex-1 items-center gap-3.5 rounded-xl border border-white/5 bg-[#1F2430] p-4 text-left transition-transform duration-150 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(212,175,55,0.15)]"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        <BossIcon boss={iconKey} />
      </span>
      <span className="min-w-0 flex-1">
        <div className="truncate font-semibold text-white">{row.label}</div>
        {leader && <div className="mt-0.5 truncate text-sm text-[#AAB2C0]">Top: {leader.displayName}</div>}
      </span>
      <ArrowIcon className="h-5 w-5 shrink-0 text-[#AAB2C0]" />
    </button>
  );
}

function BossCard({ row, leader, onActivate }: { row: CardRow; leader: LeaderboardRow | null | undefined; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button
      type="button"
      key={key}
      onClick={() => onActivate(row)}
      className="flex aspect-square flex-col items-center justify-center gap-0 rounded-xl border border-white/5 bg-[#1F2430] p-3 text-center transition-transform duration-150 hover:scale-105 hover:shadow-[0_0_20px_rgba(212,175,55,0.15)]"
    >
      <span className="flex h-10 w-10 items-center justify-center">
        <BossIcon boss={iconKey} />
      </span>
      <div className="mt-2 truncate text-sm text-white">{row.label}</div>
      {leader && <div className="mt-0.5 truncate text-xs text-[#AAB2C0]">Top: {leader.displayName}</div>}
    </button>
  );
}

function SlayerPill({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key } = rowKeyAndIcon(row);
  return (
    <button
      type="button"
      key={key}
      onClick={() => onActivate(row)}
      className="flex h-12 items-center justify-center rounded-full border border-white/5 bg-[#1F2430] px-4 text-sm text-white transition-colors duration-150 hover:border-[#D4AF37]/60"
    >
      {row.label}
    </button>
  );
}

function MinigameCard({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button
      type="button"
      key={key}
      onClick={() => onActivate(row)}
      className="flex h-20 w-40 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-white/5 bg-[#1F2430] text-center transition-transform duration-150 hover:scale-105 hover:shadow-[0_0_20px_rgba(212,175,55,0.15)]"
    >
      <span className="flex h-8 w-8 items-center justify-center">
        <BossIcon boss={iconKey} />
      </span>
      <div className="truncate px-2 text-sm text-white">{row.label}</div>
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
  topBosses,
  goToBoss,
  navigate,
}: {
  bosses: LoadState<string[]>;
  topBosses: LoadState<TopBossesOverview>;
  goToBoss: (boss: string) => void;
  navigate: (route: Route) => void;
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => (isLoaded(bosses) ? groupBosses(bosses.data) : []), [bosses]);
  const overview = isLoaded(topBosses) ? topBosses.data : undefined;

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
    <PageContainer>
      <div className="mb-2 text-xs uppercase tracking-wide text-[#AAB2C0]">
        <button type="button" onClick={() => navigate({ name: 'home' })} className="hover:text-white">Home</button> / Leaderboards
      </div>

      <Header query={query} onQueryChange={setQuery} />

      {bosses.s === 'loading' && <div className="py-4 text-sm text-[#AAB2C0]">Loading bosses...</div>}
      {bosses.s === 'error' && <div className="py-4 text-sm text-[#AAB2C0]">Boss list unavailable.</div>}

      {isLoaded(bosses) && filteredGroups.length === 0 && (
        <div className="py-4 text-sm text-[#AAB2C0]">No bosses match "{query}".</div>
      )}

      {isLoaded(bosses) &&
        filteredGroups.map(({ group, rows }: { group: { category: Category }; rows: CardRow[] }) => (
          <div className="mb-8" key={group.category}>
            <SectionHeader title={group.category} />

            {group.category === 'Raids' && (
              <div className="flex flex-wrap gap-4">
                {rows.map((row) => (
                  <RaidCard row={row} leader={findLeader(overview, rowKeyAndIcon(row).iconKey)} onActivate={activateRow} key={rowKeyAndIcon(row).key} />
                ))}
              </div>
            )}

            {group.category === 'Slayer Monsters' && (
              <div className="flex flex-wrap gap-3">
                {rows.map((row) => <SlayerPill row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />)}
              </div>
            )}

            {group.category === 'Minigames & Challenges' && (
              <div className="flex gap-4 overflow-x-auto pb-1">
                {rows.map((row) => <MinigameCard row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />)}
              </div>
            )}

            {(group.category === 'Bosses' || group.category === 'Other') && (
              <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {rows.map((row) => (
                  <BossCard row={row} leader={findLeader(overview, rowKeyAndIcon(row).iconKey)} onActivate={activateRow} key={rowKeyAndIcon(row).key} />
                ))}
              </div>
            )}
          </div>
        ))}
    </PageContainer>
  );
}
