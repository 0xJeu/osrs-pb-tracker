import { useMemo, useState } from 'react';
import type { PbEntry, PlayerPayload } from '../lib/api';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { groupPlayerRaidPbs } from '../lib/bossGroups';
import type { PlayerRaidGroup } from '../lib/bossGroups';
import type { BossRecordSort, SortDirection } from '../lib/sortTypes';
import type { Route } from '../hooks/useRoute';
import type { PlayerState } from '../hooks/usePlayerProfile';

function visiblePbs(player: PlayerPayload) {
  return hideAmbiguousBaseEntries(player.pbs, (pb) => pb.boss)
    .slice()
    .sort((a, b) => a.rank - b.rank);
}

export function PlayerView({ state, navigate }: { state: PlayerState; navigate: (route: Route) => void }) {
  // Hooks must run unconditionally on every render (Rules of Hooks), so this
  // is computed before the early returns below - it just resolves to empty
  // when there's no loaded player yet.
  const pbs = state.s === 'loaded' ? visiblePbs(state.player) : [];
  const { groups, flat } = useMemo(() => groupPlayerRaidPbs(pbs), [pbs]);
  const [recordSort, setRecordSort] = useState<BossRecordSort>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const recordRows = useMemo(() => {
    const combined = [
      ...flat.map((pb) => ({ type: 'pb' as const, key: pb.boss, name: titleCase(pb.boss), rank: pb.rank, time: pb.timeSeconds, pb })),
      ...groups.map((group) => ({
        type: 'group' as const,
        key: group.heading,
        name: group.heading,
        rank: group.summary.rank,
        time: group.summary.timeSeconds,
        group,
      })),
    ];
    const direction = sortDirection === 'asc' ? 1 : -1;
    return combined.sort((a, b) => {
      const comparison = recordSort === 'name'
        ? a.name.localeCompare(b.name)
        : recordSort === 'rank'
          ? a.rank - b.rank
          : a.time - b.time;
      return comparison * direction || a.name.localeCompare(b.name);
    });
  }, [flat, groups, recordSort, sortDirection]);

  const chooseSort = (next: BossRecordSort) => {
    if (next === recordSort) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setRecordSort(next);
    setSortDirection('asc');
  };

  const sortLabel = (key: BossRecordSort, label: string) => (
    <button
      type="button"
      className={`pbt-sort${recordSort === key ? ' active' : ''}`}
      aria-pressed={recordSort === key}
      onClick={() => chooseSort(key)}
    >
      {label}{recordSort === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  if (state.s === 'loading' || state.s === 'idle') {
    return <div className="pbt-panel-state">Loading profile...</div>;
  }
  if (state.s === 'error') return <div className="pbt-panel-state">Could not load this profile.</div>;
  if (state.s === 'notFound') return <div className="pbt-panel-state">No synced profile found for "{state.name}".</div>;
  if (state.s === 'ambiguous') return <div className="pbt-panel-state">{state.count} matching profiles found for "{state.name}".</div>;

  const bestRank = pbs.length > 0 ? Math.min(...pbs.map((pb) => pb.rank)) : undefined;
  const goToBossHighlighted = (boss: string) => navigate({ name: 'boss', boss, highlight: state.player.displayName });

  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div className="pbt-banner">
        <div className="pbt-crumbs">
          <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> / {state.player.displayName}
        </div>
        <div className="pbt-titleline">
          <h1 className="pbt-display pbt-h3">{state.player.displayName}</h1>
        </div>
      </div>

      <div className="pbt-stats">
        <div className="pbt-stat">
          <span className="num">{pbs.length}</span>
          <div className="lbl">Boss PBs held</div>
        </div>
        <div className="pbt-stat">
          <span className="num">{bestRank ? `#${bestRank}` : '-'}</span>
          <div className="lbl">Best rank</div>
        </div>
        <div className="pbt-stat">
          <span className="num">{pbs.filter((pb) => pb.rank === 1).length}</span>
          <div className="lbl">#1 records</div>
        </div>
      </div>

      <div style={{ marginTop: 56 }}>
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Boss records</h2>
          <div className="rule" />
        </div>
        {pbs.length === 0 && <div className="pbt-panel-state">No visible PBs synced yet.</div>}
        {pbs.length > 0 && (
          <div className="pbt-rows">
            <div className="pbt-thead">
              <span>{sortLabel('rank', 'Rank')}</span>
              <span>{sortLabel('name', 'Boss')}</span>
              <span>{sortLabel('time', 'Time')}</span>
              <span className="when">Synced</span>
            </div>
            {recordRows.map((row) => row.type === 'pb'
              ? <PbRow key={row.key} pb={row.pb} onBossClick={goToBossHighlighted} />
              : <RaidGroupRows key={row.key} group={row.group} onBossClick={goToBossHighlighted} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PbRow({ pb, onBossClick }: { pb: PbEntry; onBossClick: (boss: string) => void }) {
  return (
    <button type="button" className="pbt-row" onClick={() => onBossClick(pb.boss)}>
      <span className="rank">#{pb.rank}</span>
      <span className="name">{titleCase(pb.boss)}</span>
      <span className="time">{formatTime(pb.timeSeconds)}</span>
      <span className="when">{formatDate(pb.updatedAt)}</span>
    </button>
  );
}

function RaidGroupRows({ group, onBossClick }: { group: PlayerRaidGroup; onBossClick: (boss: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The row navigates to that mode's leaderboard on click; the caret is
          its own nested button (stopping propagation) so expanding the
          variant list doesn't fight with that - a real <button> can't
          contain another, so the row itself is a div with a button role. */}
      <div
        className={`pbt-brow raid${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onBossClick(group.summary.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onBossClick(group.summary.key);
        }}
      >
        <span className="rank">#{group.summary.rank}</span>
        <span className="bname">
          <button
            type="button"
            className="caret"
            aria-label={open ? 'Collapse variants' : `Show all ${group.variants.length} variants`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            ▸
          </button>
          {group.heading}
        </span>
        <span className="time">
          {formatTime(group.summary.timeSeconds)}
          <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>({group.summary.label})</span>
        </span>
        <span className="when">{formatDate(group.summary.updatedAt)}</span>
      </div>
      {open &&
        group.variants.map((variant) => (
          <button type="button" className="pbt-sub" key={variant.key} onClick={() => onBossClick(variant.key)}>
            <span className="rank">#{variant.rank}</span>
            <span className="variant">{variant.label}</span>
            <span className="time">{formatTime(variant.timeSeconds)}</span>
            <span className="when">{formatDate(variant.updatedAt)}</span>
          </button>
        ))}
    </>
  );
}
