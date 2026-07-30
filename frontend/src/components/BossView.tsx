import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardPage, LeaderboardRow } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { formatDate, formatTime } from '../lib/format';
import { bossBannerUrl } from '../lib/bossBanners';
import { getRaidModes, groupedBaseForKey, isGroupedVariant } from '../lib/bossGroups';
import type { BossRecordSort, SortDirection } from '../lib/sortTypes';
import type { Route } from '../hooks/useRoute';
import { BossComboboxCollapsed } from './BossComboboxCollapsed';
import { RaidVariantPicker } from './RaidVariantPicker';

export function BossView({
  titleParts,
  bosses,
  selectedBoss,
  highlight,
  goToBoss,
  navigate,
  leaderboard,
  setLeaderboardOffset,
  rows,
  lookupPlayer,
}: {
  titleParts: { primary: string; secondary: string };
  bosses: LoadState<string[]>;
  selectedBoss: string;
  highlight?: string;
  goToBoss: (boss: string) => void;
  navigate: (route: Route) => void;
  leaderboard: LoadState<LeaderboardPage>;
  setLeaderboardOffset: (offset: number) => void;
  rows: LeaderboardRow[];
  lookupPlayer: (name: string) => void;
}) {
  const [leaderboardSort, setLeaderboardSort] = useState<BossRecordSort>('rank');
  const [leaderboardDirection, setLeaderboardDirection] = useState<SortDirection>('asc');
  const page = isLoaded(leaderboard) ? leaderboard.data : undefined;
  const fastest = rows.length > 0 ? Math.min(...rows.map((r) => r.timeSeconds)) : undefined;
  const showRaidPicker = isLoaded(bosses) && isGroupedVariant(selectedBoss);
  const highlightLower = highlight?.toLowerCase();
  const highlightRowRef = useRef<HTMLButtonElement | null>(null);
  const sortedRows = useMemo(() => {
    const rankedRows = rows.map((row, index) => ({ row, rank: (page?.offset ?? 0) + index + 1 }));
    const direction = leaderboardDirection === 'asc' ? 1 : -1;
    return rankedRows.sort((a, b) => {
      const comparison = leaderboardSort === 'name'
        ? a.row.displayName.localeCompare(b.row.displayName)
        : leaderboardSort === 'time'
          ? a.row.timeSeconds - b.row.timeSeconds
          : a.rank - b.rank;
      return comparison * direction || a.rank - b.rank;
    });
  }, [rows, leaderboardSort, leaderboardDirection, page?.offset]);

  const chooseLeaderboardSort = (next: BossRecordSort) => {
    if (next === leaderboardSort) {
      setLeaderboardDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setLeaderboardSort(next);
    setLeaderboardDirection('asc');
  };

  const leaderboardSortLabel = (key: BossRecordSort, label: string) => (
    <button
      type="button"
      className={`pbt-sort${leaderboardSort === key ? ' active' : ''}`}
      aria-pressed={leaderboardSort === key}
      onClick={() => chooseLeaderboardSort(key)}
    >
      {label}{leaderboardSort === key ? (leaderboardDirection === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  useEffect(() => {
    if (highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight, rows]);

  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div
        className="pbt-banner pbt-boss-banner"
        style={bossBannerUrl(selectedBoss) ? ({ '--pbt-banner': `url("${bossBannerUrl(selectedBoss)}")` } as CSSProperties) : undefined}
      >
        <div className="pbt-crumbs">
          <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> /{' '}
          <button type="button" onClick={() => navigate({ name: 'leaderboards' })}>Leaderboards</button>
        </div>
        <h2 className="pbt-display pbt-h2">{titleParts.primary}</h2>
        {titleParts.secondary && <span className="meta">{titleParts.secondary}</span>}
      </div>

      <div style={{ maxWidth: 420, marginBottom: 20 }}>
        {isLoaded(bosses) ? (
          <BossComboboxCollapsed
            bosses={bosses.data}
            selected={selectedBoss}
            onSelect={goToBoss}
            onSelectRaidBase={(base) => {
              const firstVariant = getRaidModes(bosses.data, base)[0]?.variants[0]?.key;
              if (firstVariant) goToBoss(firstVariant);
            }}
          />
        ) : (
          <div className="pbt-panel-state">{bosses.s === 'error' ? 'Boss list unavailable.' : 'Loading bosses...'}</div>
        )}
      </div>

      {showRaidPicker && isLoaded(bosses) && (
        <RaidVariantPicker
          base={groupedBaseForKey(selectedBoss)}
          bosses={bosses.data}
          selected={selectedBoss}
          onSelect={goToBoss}
        />
      )}

      {leaderboard.s === 'loading' && <div className="pbt-panel-state">Loading leaderboard...</div>}
      {leaderboard.s === 'error' && <div className="pbt-panel-state">Leaderboard unavailable.</div>}
      {isLoaded(leaderboard) && rows.length === 0 && <div className="pbt-panel-state">No synced PBs for this boss yet.</div>}
      {rows.length > 0 && (
        <div className="pbt-rows pbt-leaderboard-rows">
          <div className="pbt-thead">
            <span>{leaderboardSortLabel('rank', 'Rank')}</span>
            <span>{leaderboardSortLabel('name', 'Player')}</span>
            <span>{leaderboardSortLabel('time', 'Time')}</span>
            <span className="when">Synced</span>
          </div>
          {sortedRows.map(({ row, rank }) => {
            const isHighlighted = highlightLower !== undefined && row.displayName.toLowerCase() === highlightLower;
            return (
              <button
                type="button"
                className={`pbt-row${isHighlighted ? ' me' : ''}`}
                key={`${row.displayName}-${rank}`}
                ref={isHighlighted ? highlightRowRef : undefined}
                onClick={() => lookupPlayer(row.displayName)}
              >
                <span className={`rank${rank <= 3 ? ` podium rank-${rank}` : ''}`}>
                  {String(rank).padStart(2, '0')}
                </span>
                <span className="name">
                  {row.displayName}
                  {isHighlighted && <span className="pbt-tag">Here</span>}
                </span>
                <span className="time">
                  {formatTime(row.timeSeconds)}
                  {page?.offset === 0 && fastest !== undefined && row.timeSeconds !== fastest && (
                    <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>
                      +{formatTime(row.timeSeconds - fastest)}
                    </span>
                  )}
                </span>
                <span className="when">{formatDate(row.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
      {page && page.total > page.limit && (
        <nav className="pbt-pagination" aria-label="Leaderboard pages">
          <button
            type="button"
            disabled={page.offset === 0}
            onClick={() => setLeaderboardOffset(Math.max(0, page.offset - page.limit))}
          >
            Previous
          </button>
          <span>
            {page.offset + 1}–{Math.min(page.offset + page.rows.length, page.total)} of {page.total}
          </span>
          <button
            type="button"
            disabled={page.offset + page.limit >= page.total}
            onClick={() => setLeaderboardOffset(page.offset + page.limit)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
