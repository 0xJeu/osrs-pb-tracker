import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardPage, LeaderboardRow } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { formatDate, formatTime } from '../lib/format';
import { bossBannerFit, bossBannerUrl } from '../lib/bossBanners';
import { getRaidModes, groupedBaseForKey, isGroupedVariant } from '../lib/bossGroups';
import type { BossRecordSort, SortDirection } from '../lib/sortTypes';
import type { Route } from '../hooks/useRoute';
import { BossComboboxCollapsed } from './BossComboboxCollapsed';
import { RaidVariantPicker } from './RaidVariantPicker';

type PaginationItem = number | 'ellipsis-start' | 'ellipsis-end';

export function paginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, 'ellipsis-end', totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, 'ellipsis-start', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, 'ellipsis-start', currentPage - 1, currentPage, currentPage + 1, 'ellipsis-end', totalPages];
}

function LeaderboardPagination({
  page,
  isPageLoading,
  position,
  onPageChange,
}: {
  page: LeaderboardPage;
  isPageLoading: boolean;
  position: 'top' | 'bottom';
  onPageChange: (pageNumber: number) => void;
}) {
  const totalPages = Math.ceil(page.total / page.limit);
  const currentPage = Math.floor(page.offset / page.limit) + 1;

  if (totalPages <= 1) return null;

  return (
    <nav
      className={`pbt-pagination pbt-pagination--${position}`}
      aria-label={`Leaderboard pages (${position})`}
    >
      <button
        type="button"
        className="pbt-pagination-step"
        disabled={isPageLoading || currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        Previous
      </button>
      <span className="pbt-pagination-pages">
        {paginationItems(currentPage, totalPages).map((item) => typeof item === 'number' ? (
          <button
            type="button"
            className={`pbt-pagination-number${item === currentPage ? ' active' : ''}`}
            aria-label={`Page ${item}`}
            aria-current={item === currentPage ? 'page' : undefined}
            disabled={isPageLoading}
            key={item}
            onClick={() => onPageChange(item)}
          >
            {item}
          </button>
        ) : (
          <span className="pbt-pagination-ellipsis" aria-hidden="true" key={item}>…</span>
        ))}
      </span>
      <button
        type="button"
        className="pbt-pagination-step"
        disabled={isPageLoading || currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
      </button>
    </nav>
  );
}

export function BossView({
  titleParts,
  bosses,
  selectedBoss,
  highlight,
  goToBoss,
  navigate,
  leaderboard,
  isPageLoading,
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
  isPageLoading: boolean;
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
  const leaderboardTopRef = useRef<HTMLDivElement | null>(null);
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

  const changePage = (offset: number) => {
    setLeaderboardOffset(offset);
    window.requestAnimationFrame(() => {
      leaderboardTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const goToPage = (pageNumber: number) => {
    if (!page) return;
    changePage((pageNumber - 1) * page.limit);
  };

  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div
        className={`pbt-banner pbt-boss-banner${bossBannerFit(selectedBoss) === 'contain' ? ' pbt-boss-banner--contain' : ''}`}
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

      <div
        ref={leaderboardTopRef}
        className={`pbt-leaderboard-content${isPageLoading && isLoaded(leaderboard) ? ' is-loading' : ''}`}
        aria-busy={isPageLoading}
      >
        {leaderboard.s === 'loading' && <div className="pbt-panel-state">Loading leaderboard...</div>}
        {leaderboard.s === 'error' && <div className="pbt-panel-state">Leaderboard unavailable.</div>}
        {isLoaded(leaderboard) && rows.length === 0 && <div className="pbt-panel-state">No synced PBs for this boss yet.</div>}
        {page && (
          <LeaderboardPagination
            page={page}
            isPageLoading={isPageLoading}
            position="top"
            onPageChange={goToPage}
          />
        )}
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
        {page && (
          <LeaderboardPagination
            page={page}
            isPageLoading={isPageLoading}
            position="bottom"
            onPageChange={goToPage}
          />
        )}
      </div>
    </div>
  );
}
