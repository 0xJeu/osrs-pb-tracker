import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { AmbiguousMatch, PbEntry, PlayerPayload } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { groupPlayerRaidPbs } from '../lib/bossGroups';
import type { PlayerRaidGroup } from '../lib/bossGroups';
import { AmbiguousPicker } from './AmbiguousPicker';
import { EmptyState, ErrorState, Loading } from './States';

type ResultRow = { type: 'flat'; label: string; pb: PbEntry } | { type: 'group'; label: string; group: PlayerRaidGroup };

function buildResultRows(pbs: PbEntry[]): ResultRow[] {
  const { groups, flat } = groupPlayerRaidPbs(pbs);
  const rows: ResultRow[] = [
    ...flat.map((pb): ResultRow => ({ type: 'flat', label: titleCase(pb.boss), pb })),
    ...groups.map((group): ResultRow => ({ type: 'group', label: group.heading, group })),
  ];
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

type State =
  | { s: 'loading' }
  | { s: 'error' }
  | { s: 'notFound' }
  | { s: 'ambiguous'; matches: AmbiguousMatch[] }
  | { s: 'loaded'; player: PlayerPayload };

export function PlayerResult({
  name,
  onFaqClick,
  onRankClick,
}: {
  name: string;
  onFaqClick?: () => void;
  onRankClick?: (boss: string) => void;
}) {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (heading: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      return next;
    });
  };

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .lookupPlayer(name)
      .then((result) => {
        if (!alive) return;
        if (result.kind === 'notFound') setState({ s: 'notFound' });
        else if (result.kind === 'ambiguous') setState({ s: 'ambiguous', matches: result.matches });
        else setState({ s: 'loaded', player: result.player });
      })
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [name]);

  const pickById = (id: number) => {
    setState({ s: 'loading' });
    api
      .getPlayerById(id)
      .then((result) => {
        if (result.kind === 'player') setState({ s: 'loaded', player: result.player });
        else setState({ s: 'notFound' });
      })
      .catch(() => setState({ s: 'error' }));
  };

  // Hooks must run unconditionally on every render (Rules of Hooks), so this
  // is computed here rather than after the early returns below - it just
  // resolves to an empty array whenever there's no loaded player yet.
  const visiblePbs = state.s === 'loaded' ? hideAmbiguousBaseEntries(state.player.pbs, (pb) => pb.boss) : [];
  const rows = useMemo(() => buildResultRows(visiblePbs), [visiblePbs]);

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;
  if (state.s === 'notFound') {
    return (
      <EmptyState>
        No PB data found for <strong>{name}</strong> yet. They need to sync with the PB Tracker
        Sync plugin first.
      </EmptyState>
    );
  }
  if (state.s === 'ambiguous') {
    return <AmbiguousPicker name={name} matches={state.matches} onPick={pickById} />;
  }

  const { player } = state;
  if (player.pbs.length === 0) {
    return (
      <EmptyState>
        <strong>{player.displayName}</strong> has synced, but has no recorded PBs yet.
      </EmptyState>
    );
  }

  const rankCell = (boss: string, label: string, rank: number) => (
    <td className="rank" data-label="Rank">
      {onRankClick ? (
        <button
          type="button"
          className="pb-rank-link"
          onClick={() => onRankClick(boss)}
          title={`See ${player.displayName}'s spot on the ${label} leaderboard`}
        >
          #{rank}
        </button>
      ) : (
        `#${rank}`
      )}
    </td>
  );

  const bossCell = (boss: string, label: string) => (
    <td data-label="Boss">
      {onRankClick ? (
        <button
          type="button"
          className="pb-rank-link"
          onClick={() => onRankClick(boss)}
          title={`See ${player.displayName}'s spot on the ${label} leaderboard`}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </td>
  );

  return (
    <section>
      <h2 className="result-title">{player.displayName}</h2>
      <div className="result-meta">
        Last synced {formatDate(player.updatedAt)} - {visiblePbs.length} PB(s) recorded
        {onFaqClick && (
          <>
            {' '}
            -{' '}
            <a
              href="/faq"
              onClick={(e) => {
                e.preventDefault();
                onFaqClick();
              }}
            >
              Times look wrong? See our FAQ
            </a>
          </>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Boss</th>
            <th>Personal Best</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.type === 'flat') {
              const { pb } = row;
              return (
                <tr key={pb.boss}>
                  {rankCell(pb.boss, row.label, pb.rank)}
                  {bossCell(pb.boss, row.label)}
                  <td data-label="Personal Best" className="time">
                    {formatTime(pb.timeSeconds)}
                  </td>
                  <td data-label="Recorded">{formatDate(pb.updatedAt)}</td>
                </tr>
              );
            }

            const { group } = row;
            const isOpen = expanded.has(group.heading);
            return (
              <Fragment key={group.heading}>
                <tr className="group-row">
                  {rankCell(group.summary.key, group.heading, group.summary.rank)}
                  <td data-label="Boss">
                    <button
                      type="button"
                      className="group-toggle"
                      onClick={() => toggleExpanded(group.heading)}
                      aria-expanded={isOpen}
                      title={isOpen ? 'Collapse variants' : `Show all ${group.variants.length} variants`}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>{' '}
                    {onRankClick ? (
                      <button
                        type="button"
                        className="pb-rank-link"
                        onClick={() => onRankClick(group.summary.key)}
                        title={`See ${player.displayName}'s spot on the ${group.heading} leaderboard`}
                      >
                        {group.heading}
                      </button>
                    ) : (
                      group.heading
                    )}
                  </td>
                  <td data-label="Personal Best" className="time">
                    {formatTime(group.summary.timeSeconds)} ({group.summary.label})
                  </td>
                  <td data-label="Recorded">{formatDate(group.summary.updatedAt)}</td>
                </tr>
                {isOpen &&
                  group.variants.map((variant) => (
                    <tr key={variant.key} className="group-variant-row">
                      {rankCell(variant.key, `${group.heading} - ${variant.label}`, variant.rank)}
                      {bossCell(variant.key, variant.label)}
                      <td data-label="Personal Best" className="time">
                        {formatTime(variant.timeSeconds)}
                      </td>
                      <td data-label="Recorded">{formatDate(variant.updatedAt)}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
