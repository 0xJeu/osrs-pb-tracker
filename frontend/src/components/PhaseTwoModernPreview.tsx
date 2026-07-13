import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardRow, PbEntry, PlayerPayload, QuickStats } from '../lib/api';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { BossComboboxCollapsed } from './BossComboboxCollapsed';
import { FaqPage } from './FaqPage';
import { SetupGuidePage } from './SetupGuidePage';

type LoadState<T> = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; data: T };
type PlayerState =
  | { s: 'idle' }
  | { s: 'loading'; name: string }
  | { s: 'error'; name: string }
  | { s: 'notFound'; name: string }
  | { s: 'ambiguous'; name: string; count: number }
  | { s: 'loaded'; player: PlayerPayload };
type PreviewView =
  | { name: 'leaderboard' }
  | { name: 'player'; player: string }
  | { name: 'setup' }
  | { name: 'faq' };

const previewBase = '/phase-two-modern-preview';
const preferredBosses = [
  'chambers of xeric - challenge mode - fastest overall (3 players)',
  'chambers of xeric',
  'zulrah',
];
const numberFormatter = new Intl.NumberFormat();

function viewFromPreviewPath(): PreviewView {
  const rest = window.location.pathname.slice(previewBase.length);
  const playerMatch = rest.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  if (rest === '/setup') return { name: 'setup' };
  if (rest === '/faq') return { name: 'faq' };
  return { name: 'leaderboard' };
}

function isLoaded<T>(state: LoadState<T>): state is { s: 'loaded'; data: T } {
  return state.s === 'loaded';
}

function pickInitialBoss(bosses: string[]) {
  return preferredBosses.find((boss) => bosses.includes(boss)) ?? bosses[0] ?? '';
}

function bossTitleParts(boss: string) {
  const [first, ...rest] = titleCase(boss).split(' - ');
  return {
    primary: first || 'Loading Leaderboard',
    secondary: rest.join(' - '),
  };
}

function gapFromFirst(row: LeaderboardRow, fastest?: number) {
  if (fastest === undefined || row.timeSeconds === fastest) return 'Fastest';
  return `+${formatTime(row.timeSeconds - fastest)}`;
}

function statValue(value: number | undefined) {
  return value === undefined ? '...' : numberFormatter.format(value);
}

function visiblePbs(player: PlayerPayload) {
  return hideAmbiguousBaseEntries(player.pbs, (pb) => pb.boss)
    .slice()
    .sort((a, b) => a.rank - b.rank);
}

function bossAbbr(boss: string) {
  const normalized = titleCase(boss);
  if (normalized.includes('Chambers Of Xeric')) return 'CoX';
  if (normalized.includes('Theatre Of Blood')) return 'ToB';
  if (normalized.includes('Tombs Of Amascut')) return 'ToA';
  if (normalized.includes('Inferno')) return 'Inf';
  if (normalized.includes('Gauntlet')) return 'CG';
  if (normalized.includes('Vorkath')) return 'Vrk';
  if (normalized.includes('Zulrah')) return 'Zul';
  return normalized
    .split(/\s|-/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0])
    .join('');
}

function bossColorClass(boss: string) {
  const normalized = boss.toLowerCase();
  if (normalized.includes('chambers of xeric')) return 'cox';
  if (normalized.includes('theatre of blood')) return 'tob';
  if (normalized.includes('tombs of amascut')) return 'toa';
  if (normalized.includes('inferno')) return 'inf';
  if (normalized.includes('gauntlet')) return 'cg';
  if (normalized.includes('vorkath')) return 'vrk';
  if (normalized.includes('zulrah')) return 'zul';
  return 'other';
}

export function PhaseTwoModernPreview() {
  const [view, setView] = useState<PreviewView>(viewFromPreviewPath);
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'loading' });
  const [stats, setStats] = useState<LoadState<QuickStats>>({ s: 'loading' });
  const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardRow[]>>({ s: 'loading' });
  const [selectedBoss, setSelectedBoss] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [profileState, setProfileState] = useState<PlayerState>({ s: 'idle' });
  const [sortDesc, setSortDesc] = useState(false);

  useEffect(() => {
    const onPop = () => setView(viewFromPreviewPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getBosses()
      .then((data) => {
        if (!alive) return;
        setBosses({ s: 'loaded', data });
        setSelectedBoss((current) => current || pickInitialBoss(data));
      })
      .catch(() => alive && setBosses({ s: 'error' }));
    api
      .getStats()
      .then((data) => alive && setStats({ s: 'loaded', data }))
      .catch(() => alive && setStats({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedBoss) return;
    let alive = true;
    setLeaderboard({ s: 'loading' });
    api
      .getLeaderboard(selectedBoss, 25)
      .then((data) => alive && setLeaderboard({ s: 'loaded', data }))
      .catch(() => alive && setLeaderboard({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [selectedBoss]);

  useEffect(() => {
    const query = playerQuery.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.search(query).then(setSuggestions).catch(() => setSuggestions([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [playerQuery]);

  useEffect(() => {
    if (view.name !== 'player') return;
    loadPlayer(view.player, setProfileState);
  }, [view]);

  const navigate = (next: PreviewView) => {
    const path =
      next.name === 'player'
        ? `${previewBase}/player/${encodeURIComponent(next.player)}`
        : next.name === 'setup'
          ? `${previewBase}/setup`
          : next.name === 'faq'
            ? `${previewBase}/faq`
            : previewBase;
    window.history.pushState({}, '', path);
    setView(next);
  };

  const loadPlayer = (name: string, setter: (state: PlayerState) => void) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setter({ s: 'loading', name: trimmed });
    api
      .lookupPlayer(trimmed)
      .then((result) => {
        if (result.kind === 'player') setter({ s: 'loaded', player: result.player });
        else if (result.kind === 'ambiguous') setter({ s: 'ambiguous', name: trimmed, count: result.matches.length });
        else setter({ s: 'notFound', name: trimmed });
      })
      .catch(() => setter({ s: 'error', name: trimmed }));
  };

  const lookupPlayer = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPlayerQuery('');
    setSuggestions([]);
    navigate({ name: 'player', player: trimmed });
  };

  const onPlayerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    lookupPlayer(playerQuery);
  };

  const rows = useMemo(() => {
    if (!isLoaded(leaderboard)) return [];
    return leaderboard.data
      .slice()
      .sort((a, b) => (sortDesc ? b.timeSeconds - a.timeSeconds : a.timeSeconds - b.timeSeconds));
  }, [leaderboard, sortDesc]);

  const fastest = isLoaded(leaderboard) ? Math.min(...leaderboard.data.map((row) => row.timeSeconds)) : undefined;
  const titleParts = bossTitleParts(selectedBoss);

  return (
    <div className="phase2-modern">
      <PreviewSidebar
        view={view}
        bosses={bosses}
        selectedBoss={selectedBoss}
        setSelectedBoss={(boss) => {
          setSelectedBoss(boss);
          navigate({ name: 'leaderboard' });
        }}
        playerQuery={playerQuery}
        setPlayerQuery={setPlayerQuery}
        suggestions={suggestions}
        onPlayerSubmit={onPlayerSubmit}
        lookupPlayer={lookupPlayer}
        navigate={navigate}
      />

      <main className="phase2-modern-main">
        {view.name === 'leaderboard' && (
          <LeaderboardPreview
            titleParts={titleParts}
            stats={stats}
            rows={rows}
            fastest={fastest}
            leaderboard={leaderboard}
            sortDesc={sortDesc}
            setSortDesc={setSortDesc}
            lookupPlayer={lookupPlayer}
          />
        )}
        {view.name === 'player' && <PlayerProfilePage state={profileState} navigate={navigate} />}
        {view.name === 'setup' && (
          <DocumentPage
            eyebrow="Setup"
            title="How to set up PB Tracker Sync"
            description="Install the RuneLite plugin and confirm your in-game personal bests are ready to sync."
          >
            <SetupGuidePage />
          </DocumentPage>
        )}
        {view.name === 'faq' && (
          <DocumentPage
            eyebrow="Help"
            title="FAQ"
            description="Answers for sync behavior, missing records, and how PB Tracker reads RuneLite data."
          >
            <FaqPage />
          </DocumentPage>
        )}
      </main>
    </div>
  );
}

function PreviewSidebar({
  view,
  bosses,
  selectedBoss,
  setSelectedBoss,
  playerQuery,
  setPlayerQuery,
  suggestions,
  onPlayerSubmit,
  lookupPlayer,
  navigate,
}: {
  view: PreviewView;
  bosses: LoadState<string[]>;
  selectedBoss: string;
  setSelectedBoss: (boss: string) => void;
  playerQuery: string;
  setPlayerQuery: (value: string) => void;
  suggestions: string[];
  onPlayerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lookupPlayer: (name: string) => void;
  navigate: (view: PreviewView) => void;
}) {
  const nav = [
    ['Leaderboards', { name: 'leaderboard' } as PreviewView],
    ['Players', { name: 'leaderboard' } as PreviewView],
    ['Setup', { name: 'setup' } as PreviewView],
    ['FAQ', { name: 'faq' } as PreviewView],
  ] as const;

  return (
    <aside className="phase2-modern-sidebar">
      <div className="phase2-modern-brand">
        <span>PB</span>
        <strong>PB Tracker</strong>
      </div>

      <nav aria-label="Modern preview navigation">
        {nav.map(([label, target]) => (
          <button
            key={label}
            type="button"
            className={
              (label === 'Leaderboards' && view.name === 'leaderboard') ||
              (label === 'Players' && view.name === 'player') ||
              (label === 'Setup' && view.name === 'setup') ||
              (label === 'FAQ' && view.name === 'faq')
                ? 'active'
                : undefined
            }
            onClick={() => navigate(target)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="phase2-modern-divider" />

      <section className="phase2-modern-sidebar-section">
        <label htmlFor="modern-player">Player Lookup</label>
        <form className="phase2-modern-search" onSubmit={onPlayerSubmit}>
          <input
            id="modern-player"
            value={playerQuery}
            onChange={(event) => setPlayerQuery(event.target.value)}
            placeholder="Search player..."
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>
        {suggestions.length > 0 && (
          <div className="phase2-modern-suggestions">
            {suggestions.slice(0, 6).map((name) => (
              <button key={name} type="button" onClick={() => lookupPlayer(name)}>
                {name}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="phase2-modern-sidebar-section">
        <label>Browse Leaderboard</label>
        {isLoaded(bosses) ? (
          <BossComboboxCollapsed
            bosses={bosses.data}
            selected={selectedBoss}
            onSelect={setSelectedBoss}
            onSelectRaidBase={setSelectedBoss}
          />
        ) : (
          <div className="phase2-modern-sidebar-card">
            {bosses.s === 'error' ? 'Boss list unavailable.' : 'Loading bosses...'}
          </div>
        )}
      </section>

    </aside>
  );
}

function LeaderboardPreview({
  titleParts,
  stats,
  rows,
  fastest,
  leaderboard,
  sortDesc,
  setSortDesc,
  lookupPlayer,
}: {
  titleParts: { primary: string; secondary: string };
  stats: LoadState<QuickStats>;
  rows: LeaderboardRow[];
  fastest?: number;
  leaderboard: LoadState<LeaderboardRow[]>;
  sortDesc: boolean;
  setSortDesc: (fn: (value: boolean) => boolean) => void;
  lookupPlayer: (name: string) => void;
}) {
  return (
    <>
      <Hero
        eyebrow="Live Leaderboard"
        title={titleParts.primary}
        subtitle={titleParts.secondary}
        description="Community-submitted personal bests, synced automatically from in-game plugin data."
        badge="Synced live"
      />
      <section className="phase2-modern-stats" aria-label="Summary stats">
        <div>
          <span>Synced players</span>
          <strong>{isLoaded(stats) ? statValue(stats.data.trackedPlayers) : stats.s === 'error' ? 'Unavailable' : '...'}</strong>
        </div>
        <div>
          <span>PB records</span>
          <strong>{isLoaded(stats) ? statValue(stats.data.personalBestRecords) : stats.s === 'error' ? 'Unavailable' : '...'}</strong>
        </div>
      </section>

      <div className="phase2-modern-content-grid phase2-modern-leaderboard-grid">
        <section className="phase2-modern-card phase2-modern-records-card">
          <div className="phase2-modern-card-title">
            <div>
              <span>Top Times</span>
              <h2>Overall Records</h2>
            </div>
          </div>

          <button type="button" className="phase2-modern-sortbar" onClick={() => setSortDesc((value) => !value)}>
            <span>Rank - Time - Player</span>
            <span>Sort {sortDesc ? 'down' : 'up'}</span>
          </button>

          {leaderboard.s === 'loading' && <div className="phase2-modern-panel-state">Loading leaderboard...</div>}
          {leaderboard.s === 'error' && <div className="phase2-modern-panel-state">Leaderboard unavailable.</div>}
          {isLoaded(leaderboard) && rows.length === 0 && <div className="phase2-modern-panel-state">No synced PBs for this boss yet.</div>}
          {rows.length > 0 && (
            <div className="phase2-modern-record-list">
              {rows.map((row, index) => (
                <button
                  type="button"
                  className={`phase2-modern-record-row ${index === 0 ? 'first-place' : ''}`}
                  key={`${row.displayName}-${index}`}
                  onClick={() => lookupPlayer(row.displayName)}
                >
                  <span className={`phase2-modern-medal rank-${index + 1}`}>{index + 1}</span>
                  <span className="phase2-modern-record-body">
                    <span>
                      <strong>{formatTime(row.timeSeconds)}</strong>
                      <em>{gapFromFirst(row, fastest)}</em>
                    </span>
                    <small>{row.displayName}</small>
                  </span>
                  <span className="phase2-modern-record-date">{formatDate(row.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Hero({
  eyebrow,
  title,
  subtitle,
  description,
  badge,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  description?: string;
  badge?: string;
}) {
  return (
    <header className="phase2-modern-hero">
      <div>
        <span>{eyebrow}</span>
        <h1>
          {title}
          {subtitle && <strong>{subtitle}</strong>}
        </h1>
        {description && <p>{description}</p>}
      </div>
      {badge && <div className="phase2-modern-live-pill">{badge}</div>}
    </header>
  );
}

function PlayerProfilePage({ state, navigate }: { state: PlayerState; navigate: (view: PreviewView) => void }) {
  if (state.s === 'loading' || state.s === 'idle') return <DocumentPage eyebrow="Player Profile" title="Loading player"><div className="phase2-modern-panel-state">Loading profile...</div></DocumentPage>;
  if (state.s === 'error') return <DocumentPage eyebrow="Player Profile" title="Unavailable"><div className="phase2-modern-panel-state">Could not load this profile.</div></DocumentPage>;
  if (state.s === 'notFound') return <DocumentPage eyebrow="Player Profile" title={state.name}><div className="phase2-modern-panel-state">No synced profile found.</div></DocumentPage>;
  if (state.s === 'ambiguous') return <DocumentPage eyebrow="Player Profile" title={state.name}><div className="phase2-modern-panel-state">{state.count} matching profiles found.</div></DocumentPage>;

  const pbs = visiblePbs(state.player);
  const bestRank = pbs.length > 0 ? Math.min(...pbs.map((pb) => pb.rank)) : undefined;
  return (
    <>
      <header className="phase2-modern-hero phase2-modern-profile-hero">
        <div className="phase2-modern-avatar">{state.player.displayName.charAt(0).toUpperCase()}</div>
        <div>
          <span>Player Profile</span>
          <h1>{state.player.displayName}</h1>
        </div>
        <div className="phase2-modern-live-pill">Last synced {formatDate(state.player.updatedAt)}</div>
      </header>

      <section className="phase2-modern-stats phase2-modern-profile-stats" aria-label="Player stats">
        <div>
          <span>Boss PBs held</span>
          <strong>{pbs.length}</strong>
        </div>
        <div>
          <span>Best rank</span>
          <strong>{bestRank ? `#${bestRank}` : '-'}</strong>
        </div>
        <div>
          <span>#1 records</span>
          <strong>{pbs.filter((pb) => pb.rank === 1).length}</strong>
        </div>
      </section>

      <div className="phase2-modern-content-grid">
        <section>
          <div className="phase2-modern-section-heading">
            <span>Personal Bests</span>
            <h2>Boss Records</h2>
          </div>
          <BossPbList pbs={pbs} large />
        </section>
        <section className="phase2-modern-card phase2-modern-player-card">
          <div className="phase2-modern-card-title">
            <div>
              <span>Profile</span>
              <h2>Actions</h2>
            </div>
          </div>
          <div className="phase2-modern-player">
            <button type="button" className="phase2-modern-panel-action" onClick={() => navigate({ name: 'leaderboard' })}>
              Back to leaderboards
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

function BossPbList({ pbs, large = false }: { pbs: PbEntry[]; large?: boolean }) {
  if (pbs.length === 0) return <div className="phase2-modern-panel-state">No visible PBs synced yet.</div>;
  return (
    <div className={`phase2-modern-boss-list ${large ? 'large' : ''}`}>
      {pbs.map((pb) => (
        <div key={pb.boss} className="phase2-modern-pb-row">
          <span className={`phase2-modern-boss-chip ${bossColorClass(pb.boss)}`}>{bossAbbr(pb.boss)}</span>
          <span>
            <strong>{titleCase(pb.boss)}</strong>
            <small>{formatDate(pb.updatedAt)}</small>
          </span>
          <em>{formatTime(pb.timeSeconds)}</em>
          <b>#{pb.rank}</b>
        </div>
      ))}
    </div>
  );
}

function DocumentPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <>
      <Hero eyebrow={eyebrow} title={title} description={description} />
      <section className="phase2-modern-card phase2-modern-document">{children}</section>
    </>
  );
}
