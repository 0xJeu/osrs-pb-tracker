import { useMemo, useState } from 'react';
import '../tailwind.css';
import { isLoaded, type LoadState } from '../lib/loadState';
import { bossMonogram } from '../lib/bossPetIcons';
import { useBossIconUrl } from '../lib/bossIcons';
import { basesFromGroups, getRaidModes, groupBosses, type Category } from '../lib/bossGroups';
import { matchesBossSearch } from '../lib/bossAliases';
import type { Route } from '../hooks/useRoute';
import type { LeaderboardRow } from '../lib/api';

// Colors below are Tailwind arbitrary values referencing the rest of the
// site's own tokens (theme-osrs-preview.css) instead of a one-off palette,
// so this page reads as the same site: --pbt-yellow for readable/emphasized
// text (matches every other heading), --pbt-orange for icons/borders/accents
// (matches .pbt-donate, .pbt-tag, card hover states), and the --pbt-bg-*
// tiers already used by .pbt-card for panel/card surfaces. Referenced as
// literal `var(--pbt-*)` strings rather than JS constants interpolated into
// the class name, since Tailwind's content scanner needs the literal
// `text-[var(--pbt-yellow)]`-shaped string present in the source to generate
// the utility - a template-interpolated class name wouldn't be found.

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
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-[var(--pbt-yellow)] opacity-60">
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

function ChevronIcon({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} style={style}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" />
      <path d="M8 5H5a2 2 0 0 0 2 3.5M16 5h3a2 2 0 0 1-2 3.5" />
      <path d="M12 12v3M9 19h6M10 19v-2.5a2 2 0 0 1 4 0V19" />
    </svg>
  );
}

function SwordsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M4 4l7 7M4 4v4M4 4h4" />
      <path d="M20 4l-7 7M20 4v4M20 4h-4" />
      <path d="M4 20l6-6M20 20l-6-6" />
    </svg>
  );
}

function SkullIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.3 4.4 3 5.7V18a1 1 0 0 0 1 1h1v1.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V19h1v1.5a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5V19h1a1 1 0 0 0 1-1v-2.3c1.7-1.3 3-3.1 3-5.7a7 7 0 0 0-7-7Z" />
      <circle cx="9.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2.5l2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 16.6l-5.6 3 1.4-6.3-4.8-4.3 6.4-.6L12 2.5Z" />
    </svg>
  );
}

const CATEGORY_ICON: Record<Category, (props: { className?: string }) => JSX.Element> = {
  Raids: SwordsIcon,
  Bosses: SkullIcon,
  'Slayer Monsters': SkullIcon,
  'Minigames & Challenges': StarIcon,
  Other: SkullIcon,
};

const CATEGORY_DESCRIPTION: Record<Category, string> = {
  Raids: 'Compete in the biggest PvM encounters.',
  Bosses: 'Track your kills across all major bosses.',
  'Slayer Monsters': 'Compare your slayer task performance.',
  'Minigames & Challenges': 'Minigames, challenges and special content.',
  Other: 'Everything else.',
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
  // spacing in effect, matching the OSRSPB-style mockup regardless of what
  // page shell it's mounted inside on this site.
  return (
    <div className="-mx-10 bg-[var(--pbt-bg)] px-6 pb-16 pt-8 text-[var(--pbt-yellow)]">
      <div className="mx-auto max-w-[1400px]">{children}</div>
    </div>
  );
}

function Header({ query, onQueryChange }: { query: string; onQueryChange: (value: string) => void }) {
  return (
    <div className="mb-10 flex flex-wrap items-start justify-between gap-6">
      <div className="flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-[var(--pbt-line)] bg-[var(--pbt-bg-2)] text-[var(--pbt-orange)]">
          <TrophyIcon className="h-8 w-8" />
        </span>
        <div>
          <h2 className="m-0 text-4xl font-bold text-[var(--pbt-yellow)]">Leaderboards</h2>
          <p className="mt-1.5 text-2xl font-semibold text-[var(--pbt-yellow)] opacity-70">Find out where you rank.</p>
        </div>
      </div>
      <label className="flex h-12 w-[360px] items-center gap-2 rounded-lg border border-[var(--pbt-line)] bg-[var(--pbt-bg-2)] px-4">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search bosses, raids, minigames..."
          aria-label="Search bosses, raids, minigames"
          className="w-full bg-transparent text-base text-[var(--pbt-yellow)] placeholder:text-[var(--pbt-yellow)] placeholder:opacity-60 focus:outline-none"
        />
        <SearchIcon />
      </label>
    </div>
  );
}

function SectionPanel({
  category,
  open,
  onToggle,
  children,
}: {
  category: Category;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <div className="mb-6 rounded-2xl border-l-4 border-y border-r border-y-[var(--pbt-line-soft)] border-r-[var(--pbt-line-soft)] border-l-[var(--pbt-orange)] bg-[var(--pbt-bg-2)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-4 bg-transparent p-6 text-left transition-colors duration-150 hover:bg-[var(--pbt-bg-3)]"
      >
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-[var(--pbt-line)] bg-[var(--pbt-bg-3)] text-[var(--pbt-orange)]">
          <Icon className="h-7 w-7" />
        </span>
        <span className="min-w-0 flex-1">
          <div className="text-2xl font-semibold text-[var(--pbt-yellow)]">{category}</div>
          <div className="mt-1 text-sm text-[var(--pbt-yellow)] opacity-70">{CATEGORY_DESCRIPTION[category]}</div>
        </span>
        <ChevronIcon className={`h-6 w-6 shrink-0 text-[var(--pbt-orange)] transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
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
      className="flex h-[136px] flex-1 items-center gap-5 rounded-xl border border-[var(--pbt-line)] bg-[var(--pbt-bg-2)] p-5 text-left transition-transform duration-150 hover:scale-[1.02] hover:border-[var(--pbt-orange)] hover:bg-[var(--pbt-bg-3)] hover:shadow-[0_0_20px_rgba(255,152,31,0.15)]"
    >
      <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg">
        <BossIcon boss={iconKey} />
      </span>
      <span className="min-w-0 flex-1">
        <div className="truncate text-2xl font-semibold text-[var(--pbt-yellow)]">{row.label}</div>
        {leader && <div className="mt-1 truncate text-base text-[var(--pbt-yellow)] opacity-70">Top: {leader.displayName}</div>}
      </span>
      <ArrowIcon className="h-6 w-6 shrink-0 text-[var(--pbt-orange)]" />
    </button>
  );
}

function GridCard({ row, onActivate }: { row: CardRow; onActivate: (row: CardRow) => void }) {
  const { key, iconKey } = rowKeyAndIcon(row);
  return (
    <button
      type="button"
      key={key}
      onClick={() => onActivate(row)}
      className="flex aspect-square flex-col items-center justify-center gap-0 rounded-xl border border-[var(--pbt-line)] bg-[var(--pbt-bg-2)] p-4 text-center transition-transform duration-150 hover:scale-105 hover:border-[var(--pbt-orange)] hover:bg-[var(--pbt-bg-3)] hover:shadow-[0_0_20px_rgba(255,152,31,0.15)]"
    >
      <span className="flex h-20 w-20 items-center justify-center">
        <BossIcon boss={iconKey} />
      </span>
      <div className="mt-3 truncate text-lg font-medium text-[var(--pbt-yellow)]">{row.label}</div>
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
}: {
  bosses: LoadState<string[]>;
  topBosses: LoadState<TopBossesOverview>;
  goToBoss: (boss: string) => void;
  navigate: (route: Route) => void;
}) {
  const [query, setQuery] = useState('');
  // Which sections the user has explicitly opened/closed by hand. Separate
  // from the effective open state below, so a search's forced-open sections
  // don't clobber what the user had toggled before they started typing -
  // clearing the search restores exactly what they'd set.
  const [manuallyOpen, setManuallyOpen] = useState<Set<Category>>(new Set());

  const groups = useMemo(() => (isLoaded(bosses) ? groupBosses(bosses.data) : []), [bosses]);
  const overview = isLoaded(topBosses) ? topBosses.data : undefined;
  const isSearching = query.trim().length > 0;

  const filteredGroups = useMemo(() => {
    const q = query.trim();
    if (!q) return groups.map((group) => ({ group, rows: buildCardRows(group) }));
    return groups
      .map((group) => ({ group, rows: buildCardRows(group).filter((row) => rowMatchesQuery(row, q)) }))
      .filter(({ rows }) => rows.length > 0);
  }, [groups, query]);

  const toggleSection = (category: Category) => {
    setManuallyOpen((prev) => {
      const next = new Set(prev);
      // While searching, every rendered section is force-open (see isOpen
      // below) regardless of what's in this set - so a click here is toggling
      // relative to that forced-open state, not the possibly-stale manual
      // state from before the search started.
      const currentlyOpen = isSearching || next.has(category);
      if (currentlyOpen) next.delete(category);
      else next.add(category);
      return next;
    });
  };

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
      <Header query={query} onQueryChange={setQuery} />

      {bosses.s === 'loading' && <div className="py-4 text-sm text-[var(--pbt-yellow)] opacity-70">Loading bosses...</div>}
      {bosses.s === 'error' && <div className="py-4 text-sm text-[var(--pbt-yellow)] opacity-70">Boss list unavailable.</div>}

      {isLoaded(bosses) && filteredGroups.length === 0 && (
        <div className="py-4 text-sm text-[var(--pbt-yellow)] opacity-70">No bosses match "{query}".</div>
      )}

      {isLoaded(bosses) &&
        filteredGroups.map(({ group, rows }: { group: { category: Category }; rows: CardRow[] }) => (
          <SectionPanel
            category={group.category}
            key={group.category}
            // Every rendered section already only has matching rows (see the
            // filter above), so a search should surface all of them rather
            // than leaving results hidden inside whatever was collapsed
            // before the user started typing.
            open={isSearching || manuallyOpen.has(group.category)}
            onToggle={() => toggleSection(group.category)}
          >
            {group.category === 'Raids' ? (
              <div className="flex flex-wrap gap-4">
                {rows.map((row) => (
                  <RaidCard row={row} leader={findLeader(overview, rowKeyAndIcon(row).iconKey)} onActivate={activateRow} key={rowKeyAndIcon(row).key} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {rows.map((row) => (
                  <GridCard row={row} onActivate={activateRow} key={rowKeyAndIcon(row).key} />
                ))}
              </div>
            )}
          </SectionPanel>
        ))}
    </PageContainer>
  );
}
