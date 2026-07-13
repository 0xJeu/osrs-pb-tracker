import { CSSProperties, FormEvent, useEffect, useMemo, useState } from 'react';
import '../theme-osrs-preview.css';
import { api } from '../lib/api';
import type { LeaderboardRow, PbEntry, PlayerPayload, QuickStats, RecentSync } from '../lib/api';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { bossMonogram, useBossPetIconUrl } from '../lib/bossPetIcons';
import { bossAccentColor } from '../lib/bossColors';
import { getRaidModes, groupPlayerRaidPbs, isGroupedVariant } from '../lib/bossGroups';
import type { PlayerRaidGroup } from '../lib/bossGroups';
import { BossComboboxCollapsed } from './BossComboboxCollapsed';
import { RaidVariantPicker } from './RaidVariantPicker';

type LoadState<T> = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; data: T };
type PlayerState =
  | { s: 'idle' }
  | { s: 'loading'; name: string }
  | { s: 'error'; name: string }
  | { s: 'notFound'; name: string }
  | { s: 'ambiguous'; name: string; count: number }
  | { s: 'loaded'; player: PlayerPayload };
type PreviewView = { name: 'home' } | { name: 'boss'; boss: string } | { name: 'player'; player: string };

const previewBase = '/phase-two-osrs-preview';
const preferredBosses = [
  'chambers of xeric - challenge mode - fastest overall (3 players)',
  'chambers of xeric',
  'zulrah',
];

// Curated set for the "Top Bosses" cards - each resolved against the real
// boss list once it loads, since exact synced-key formatting (raid variant
// suffixes, dashes) can't be hardcoded reliably.
const TOP_BOSS_BASES = ['theatre of blood', 'chambers of xeric', 'tombs of amascut', 'inferno', 'vorkath'];

// Featured artwork tiles, per RuneDan's INTEGRATION.md asset map. Raid bases
// resolve through getRaidModes (same as the boss combobox's "choose a raid"
// drill-down); non-raid bosses resolve by matching the tracked boss list.
const FEATURED_ARENAS = [
  { base: 'theatre of blood', label: 'Theatre of Blood', meta: 'Raid - Entry / Normal / Hard', img: 'Theatre_of_Blood_artwork.jpg', big: true },
  { base: 'inferno', label: 'The Inferno', meta: 'Solo wave survival', img: 'TzKal-Zuk_artwork.jpg', big: false },
  { base: 'chambers of xeric', label: 'Chambers of Xeric', meta: 'Raid - Solo to 24+', img: 'Chambers_of_Xeric_artwork.jpg', big: false },
  { base: 'tombs of amascut', label: 'Tombs of Amascut', meta: 'Raid - Entry / Normal / Expert', img: 'Tombs_of_Amascut_%281%29.jpg', big: false },
  { base: 'fortis colosseum', label: 'Fortis Colosseum', meta: 'Solo wave survival', img: 'Fortis_Colosseum_-_colossi_concept_art.jpg', big: false },
] as const;

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

function viewFromPreviewPath(): PreviewView {
  const rest = window.location.pathname.slice(previewBase.length);
  const playerMatch = rest.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = rest.match(/^\/boss\/(.+)$/);
  if (bossMatch) return { name: 'boss', boss: decodeURIComponent(bossMatch[1]) };
  return { name: 'home' };
}

function isLoaded<T>(state: LoadState<T>): state is { s: 'loaded'; data: T } {
  return state.s === 'loaded';
}

function pickInitialBoss(bosses: string[]) {
  return preferredBosses.find((boss) => bosses.includes(boss)) ?? bosses[0] ?? '';
}

function bossTitleParts(boss: string) {
  const [first, ...rest] = titleCase(boss).split(' - ');
  return { primary: first || 'Loading Leaderboard', secondary: rest.join(' - ') };
}

function statValue(value: number | undefined) {
  const numberFormatter = new Intl.NumberFormat();
  return value === undefined ? '...' : numberFormatter.format(value);
}

function visiblePbs(player: PlayerPayload) {
  return hideAmbiguousBaseEntries(player.pbs, (pb) => pb.boss)
    .slice()
    .sort((a, b) => a.rank - b.rank);
}

// Resolves a curated "base" name (e.g. "theatre of blood") to a real,
// currently-synced boss key: raid/grouped bosses go through getRaidModes
// (their default mode's first variant), everything else matches directly
// against the tracked boss list.
function resolveBossKey(bosses: string[], base: string): string | undefined {
  if (isGroupedVariant(base)) {
    const modes = getRaidModes(bosses, base);
    return modes[0]?.variants[0]?.key;
  }
  return bosses.find((b) => normalize(b) === base || normalize(b).startsWith(base));
}

// Request a thumb ~2x the rendered box (32px sm / 64px lg boxes at 72% fit)
// so icons stay crisp on retina displays without over-fetching.
const PET_ICON_PIXEL_WIDTH: Record<'sm' | 'lg', number> = { sm: 64, lg: 128 };

function PetIcon({ boss, size = 'sm' }: { boss: string; size?: 'sm' | 'lg' }) {
  const url = useBossPetIconUrl(boss, PET_ICON_PIXEL_WIDTH[size]);
  return (
    <span className={`pbt-pet ${size}`}>
      {url ? <img src={url} alt="" loading="lazy" /> : bossMonogram(boss)}
    </span>
  );
}

export function PhaseTwoOsrsPreview() {
  const [view, setView] = useState<PreviewView>(viewFromPreviewPath);
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'loading' });
  const [stats, setStats] = useState<LoadState<QuickStats>>({ s: 'loading' });
  const [recentSyncs, setRecentSyncs] = useState<LoadState<RecentSync[]>>({ s: 'loading' });
  const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardRow[]>>({ s: 'loading' });
  const [topBosses, setTopBosses] = useState<LoadState<Array<{ base: string; label: string; key: string; row?: LeaderboardRow }>>>({ s: 'loading' });
  const [selectedBoss, setSelectedBoss] = useState('');
  const [playerQuery, setPlayerQuery] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [profileState, setProfileState] = useState<PlayerState>({ s: 'idle' });

  useEffect(() => {
    const onPop = () => setView(viewFromPreviewPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let alive = true;
    api.getBosses().then((data) => {
      if (!alive) return;
      setBosses({ s: 'loaded', data });
      setSelectedBoss((current) => current || pickInitialBoss(data));
    }).catch(() => alive && setBosses({ s: 'error' }));
    api.getStats().then((data) => alive && setStats({ s: 'loaded', data })).catch(() => alive && setStats({ s: 'error' }));
    api.getRecentSyncs(6).then((data) => alive && setRecentSyncs({ s: 'loaded', data })).catch(() => alive && setRecentSyncs({ s: 'error' }));
    return () => { alive = false; };
  }, []);

  // Bounded (5 requests, once bosses load) fetch of the #1 time for each
  // curated "Top Bosses" card - not worth a dedicated backend endpoint for a
  // feasibility spike.
  useEffect(() => {
    if (!isLoaded(bosses)) return;
    let alive = true;
    const resolved = TOP_BOSS_BASES
      .map((base) => {
        const key = resolveBossKey(bosses.data, base);
        return key ? { base, label: titleCase(base), key } : undefined;
      })
      .filter((v): v is { base: string; label: string; key: string } => Boolean(v));

    setTopBosses({ s: 'loaded', data: resolved });
    Promise.all(resolved.map((entry) => api.getLeaderboard(entry.key, 1).catch(() => [] as LeaderboardRow[])))
      .then((results) => {
        if (!alive) return;
        setTopBosses({
          s: 'loaded',
          data: resolved.map((entry, i) => ({ ...entry, row: results[i]?.[0] })),
        });
      });
    return () => { alive = false; };
  }, [bosses]);

  // The boss page's selected boss is driven by the URL (view.boss), not the
  // other way around - landing directly on /boss/<key>, following a link, or
  // switching via the picker all just change view.boss and this follows.
  useEffect(() => {
    if (view.name === 'boss' && view.boss) setSelectedBoss(view.boss);
  }, [view]);

  useEffect(() => {
    if (!selectedBoss) return;
    let alive = true;
    setLeaderboard({ s: 'loading' });
    api.getLeaderboard(selectedBoss, 25).then((data) => alive && setLeaderboard({ s: 'loaded', data })).catch(() => alive && setLeaderboard({ s: 'error' }));
    return () => { alive = false; };
  }, [selectedBoss]);

  useEffect(() => {
    const query = playerQuery.trim();
    if (query.length < 2) { setSuggestions([]); return; }
    const timer = window.setTimeout(() => {
      api.search(query).then(setSuggestions).catch(() => setSuggestions([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [playerQuery]);

  useEffect(() => {
    if (view.name !== 'player') return;
    const trimmed = view.player.trim();
    setProfileState({ s: 'loading', name: trimmed });
    api.lookupPlayer(trimmed).then((result) => {
      if (result.kind === 'player') setProfileState({ s: 'loaded', player: result.player });
      else if (result.kind === 'ambiguous') setProfileState({ s: 'ambiguous', name: trimmed, count: result.matches.length });
      else setProfileState({ s: 'notFound', name: trimmed });
    }).catch(() => setProfileState({ s: 'error', name: trimmed }));
  }, [view]);

  const navigate = (next: PreviewView) => {
    const path =
      next.name === 'player'
        ? `${previewBase}/player/${encodeURIComponent(next.player)}`
        : next.name === 'boss'
          ? `${previewBase}/boss/${encodeURIComponent(next.boss)}`
          : previewBase;
    window.history.pushState({}, '', path);
    setView(next);
    // Each of these is its own "page" - switching between them (or between
    // two different bosses) should always land at the top, not wherever the
    // previous page happened to be scrolled to.
    window.scrollTo(0, 0);
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

  const rows = useMemo(() => (isLoaded(leaderboard) ? leaderboard.data : []), [leaderboard]);
  const titleParts = bossTitleParts(selectedBoss);
  // Only tint the page while actually looking at a boss's leaderboard - Home
  // and player pages stay neutral so the accent reads as "this page is about
  // this boss," not just "whatever was last clicked."
  const accentColor = view.name === 'boss' && selectedBoss ? bossAccentColor(selectedBoss) : undefined;
  const goToBoss = (boss: string) => navigate({ name: 'boss', boss });

  return (
    <div
      className="pbt"
      style={accentColor ? ({ '--pbt-accent': accentColor, '--pbt-tint': '22%' } as CSSProperties) : undefined}
    >
      <div className="pbt-topbar">
        <div className="pbt-topbar-inner">
          <button type="button" className="pbt-logo" onClick={() => navigate({ name: 'home' })}>
            PB Tracker — OSRS
          </button>
          <div className="pbt-topbar-rule" />
          <nav className="pbt-nav" aria-label="Preview navigation">
            <button type="button" className={view.name === 'home' ? 'active' : undefined} onClick={() => navigate({ name: 'home' })}>
              Home
            </button>
            <button
              type="button"
              className={view.name === 'boss' ? 'active' : undefined}
              onClick={() => goToBoss(selectedBoss || pickInitialBoss(isLoaded(bosses) ? bosses.data : []))}
            >
              Leaderboards
            </button>
          </nav>
        </div>
      </div>

      <div className="pbt-page">
        {view.name === 'home' && (
          <HomeView
            stats={stats}
            recentSyncs={recentSyncs}
            topBosses={topBosses}
            bosses={bosses}
            playerQuery={playerQuery}
            setPlayerQuery={setPlayerQuery}
            suggestions={suggestions}
            onPlayerSubmit={onPlayerSubmit}
            lookupPlayer={lookupPlayer}
            goToBoss={goToBoss}
          />
        )}
        {view.name === 'boss' && (
          <BossView
            titleParts={titleParts}
            bosses={bosses}
            selectedBoss={selectedBoss}
            goToBoss={goToBoss}
            navigate={navigate}
            leaderboard={leaderboard}
            rows={rows}
            lookupPlayer={lookupPlayer}
          />
        )}
        {view.name === 'player' && <PlayerView state={profileState} navigate={navigate} />}
      </div>

      <div className="pbt-footer">
        <div className="pbt-footer-inner">
          Phase 2 OSRS-theme spike — real live data, hotlinked font/wiki assets, not production-ready.
        </div>
      </div>
    </div>
  );
}

function HomeView({
  stats,
  recentSyncs,
  topBosses,
  bosses,
  playerQuery,
  setPlayerQuery,
  suggestions,
  onPlayerSubmit,
  lookupPlayer,
  goToBoss,
}: {
  stats: LoadState<QuickStats>;
  recentSyncs: LoadState<RecentSync[]>;
  topBosses: LoadState<Array<{ base: string; label: string; key: string; row?: LeaderboardRow }>>;
  bosses: LoadState<string[]>;
  playerQuery: string;
  setPlayerQuery: (value: string) => void;
  suggestions: string[];
  onPlayerSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lookupPlayer: (name: string) => void;
  goToBoss: (boss: string) => void;
}) {
  const selectArena = (base: string) => {
    if (!isLoaded(bosses)) return;
    const key = resolveBossKey(bosses.data, base);
    if (key) goToBoss(key);
  };

  return (
    <>
      <div className="pbt-section" style={{ paddingTop: 56 }}>
        <div className="pbt-kicker">
          <span>Gamewide personal-best leaderboards</span>
          <span className="rule" />
        </div>
        <h1 className="pbt-display pbt-h1">Who holds the record?</h1>

        <form onSubmit={onPlayerSubmit} style={{ marginTop: 36 }}>
          <div className="pbt-searchband">
            <input
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              placeholder="Look up a player, e.g. Blitzen"
              autoComplete="off"
            />
            <button type="submit">Search</button>
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="pbt-suggestions">
            {suggestions.slice(0, 6).map((name) => (
              <button key={name} type="button" onClick={() => lookupPlayer(name)}>{name}</button>
            ))}
          </div>
        )}

        <div className="pbt-stats">
          <div className="pbt-stat">
            <span className="num">{isLoaded(stats) ? statValue(stats.data.trackedPlayers) : stats.s === 'error' ? '—' : '...'}</span>
            <div className="lbl">Tracked players</div>
            <span className="idx">01</span>
          </div>
          <div className="pbt-stat">
            <span className="num">{isLoaded(stats) ? statValue(stats.data.personalBestRecords) : stats.s === 'error' ? '—' : '...'}</span>
            <div className="lbl">PB records</div>
            <span className="idx">02</span>
          </div>
          <div className="pbt-stat">
            <span className="num">{isLoaded(bosses) ? statValue(bosses.data.length) : '...'}</span>
            <div className="lbl">Bosses & raid modes</div>
            <span className="idx">03</span>
          </div>
        </div>
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Featured</h2>
          <div className="rule" />
        </div>
        <div className="pbt-arenas">
          {FEATURED_ARENAS.map((arena, index) => (
            <button
              type="button"
              key={arena.base}
              className={`pbt-arena${arena.big ? ' big' : ''}`}
              onClick={() => selectArena(arena.base)}
            >
              <span className="img" style={{ backgroundImage: `url('https://oldschool.runescape.wiki/images/${arena.img}')` }} />
              <span className="idx">{String(index + 1).padStart(2, '0')}</span>
              <span className="label">
                <span className="aname">{arena.label}</span>
                <span className="ameta">{arena.meta}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Top bosses</h2>
          <div className="rule" />
        </div>
        {topBosses.s === 'loading' && <div className="pbt-panel-state">Loading top bosses...</div>}
        {isLoaded(topBosses) && (
          <div className="pbt-cards">
            {topBosses.data.map((entry, index) => (
              <button type="button" className="pbt-card" key={entry.base} onClick={() => goToBoss(entry.key)}>
                <span className="idx">{String(index + 1).padStart(2, '0')}</span>
                <PetIcon boss={entry.key} size="lg" />
                <div className="bname">{entry.label}</div>
                {entry.row ? (
                  <>
                    <div className="btime">{formatTime(entry.row.timeSeconds)}</div>
                    <div className="brank">{entry.row.displayName}</div>
                  </>
                ) : (
                  <div className="brank">No synced time yet</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Recent syncs</h2>
          <div className="rule" />
        </div>
        {recentSyncs.s === 'loading' && <div className="pbt-panel-state">Loading recent syncs...</div>}
        {recentSyncs.s === 'error' && <div className="pbt-panel-state">Recent syncs unavailable.</div>}
        {isLoaded(recentSyncs) && (
          <div className="pbt-rows">
            {recentSyncs.data.map((sync, index) => (
              <button type="button" className="pbt-row" key={sync.id} onClick={() => lookupPlayer(sync.displayName)}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span />
                <span className="name">{sync.displayName}</span>
                <span className="time">{sync.pbCount} PBs</span>
                <span className="when">{formatDate(sync.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function BossView({
  titleParts,
  bosses,
  selectedBoss,
  goToBoss,
  navigate,
  leaderboard,
  rows,
  lookupPlayer,
}: {
  titleParts: { primary: string; secondary: string };
  bosses: LoadState<string[]>;
  selectedBoss: string;
  goToBoss: (boss: string) => void;
  navigate: (view: PreviewView) => void;
  leaderboard: LoadState<LeaderboardRow[]>;
  rows: LeaderboardRow[];
  lookupPlayer: (name: string) => void;
}) {
  const fastest = rows.length > 0 ? Math.min(...rows.map((r) => r.timeSeconds)) : undefined;
  const showRaidPicker = isLoaded(bosses) && isGroupedVariant(selectedBoss);

  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div className="pbt-crumbs">
        <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> / Leaderboards
      </div>

      <div className="pbt-sec-head">
        <h2 className="pbt-display pbt-h2">{titleParts.primary}</h2>
        <div className="rule" />
        {titleParts.secondary && <span className="meta">{titleParts.secondary}</span>}
      </div>

      <div style={{ maxWidth: 420, marginBottom: 20 }}>
        {isLoaded(bosses) ? (
          <BossComboboxCollapsed
            bosses={bosses.data}
            selected={selectedBoss}
            onSelect={goToBoss}
            onSelectRaidBase={goToBoss}
          />
        ) : (
          <div className="pbt-panel-state">{bosses.s === 'error' ? 'Boss list unavailable.' : 'Loading bosses...'}</div>
        )}
      </div>

      {showRaidPicker && isLoaded(bosses) && (
        <RaidVariantPicker
          base={selectedBoss.split(' - ')[0]}
          bosses={bosses.data}
          selected={selectedBoss}
          onSelect={goToBoss}
        />
      )}

      {leaderboard.s === 'loading' && <div className="pbt-panel-state">Loading leaderboard...</div>}
      {leaderboard.s === 'error' && <div className="pbt-panel-state">Leaderboard unavailable.</div>}
      {isLoaded(leaderboard) && rows.length === 0 && <div className="pbt-panel-state">No synced PBs for this boss yet.</div>}
      {rows.length > 0 && (
        <div className="pbt-rows">
          <div className="pbt-thead">
            <span>Rank</span>
            <span />
            <span>Player</span>
            <span>Time</span>
            <span className="when">Synced</span>
          </div>
          {rows.map((row, index) => (
            <button
              type="button"
              className="pbt-row"
              key={`${row.displayName}-${index}`}
              onClick={() => lookupPlayer(row.displayName)}
            >
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <PetIcon boss={selectedBoss} size="sm" />
              <span className="name">{row.displayName}</span>
              <span className="time">
                {formatTime(row.timeSeconds)}
                {fastest !== undefined && row.timeSeconds !== fastest && (
                  <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>
                    +{formatTime(row.timeSeconds - fastest)}
                  </span>
                )}
              </span>
              <span className="when">{formatDate(row.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerView({ state, navigate }: { state: PlayerState; navigate: (view: PreviewView) => void }) {
  // Hooks must run unconditionally on every render (Rules of Hooks), so this
  // is computed before the early returns below - it just resolves to empty
  // when there's no loaded player yet.
  const pbs = state.s === 'loaded' ? visiblePbs(state.player) : [];
  const { groups, flat } = useMemo(() => groupPlayerRaidPbs(pbs), [pbs]);

  if (state.s === 'loading' || state.s === 'idle') {
    return <div className="pbt-panel-state">Loading profile...</div>;
  }
  if (state.s === 'error') return <div className="pbt-panel-state">Could not load this profile.</div>;
  if (state.s === 'notFound') return <div className="pbt-panel-state">No synced profile found for "{state.name}".</div>;
  if (state.s === 'ambiguous') return <div className="pbt-panel-state">{state.count} matching profiles found for "{state.name}".</div>;

  const bestRank = pbs.length > 0 ? Math.min(...pbs.map((pb) => pb.rank)) : undefined;

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
              <span>Rank</span>
              <span />
              <span>Boss</span>
              <span>Time</span>
              <span className="when">Synced</span>
            </div>
            {flat
              .slice()
              .sort((a, b) => titleCase(a.boss).localeCompare(titleCase(b.boss)))
              .map((pb) => (
                <PbRow key={pb.boss} pb={pb} />
              ))}
            {groups
              .slice()
              .sort((a, b) => a.heading.localeCompare(b.heading))
              .map((group) => (
                <RaidGroupRows key={group.heading} group={group} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PbRow({ pb }: { pb: PbEntry }) {
  return (
    <div className="pbt-row" style={{ cursor: 'default' }}>
      <span className="rank">#{pb.rank}</span>
      <PetIcon boss={pb.boss} size="sm" />
      <span className="name">{titleCase(pb.boss)}</span>
      <span className="time">{formatTime(pb.timeSeconds)}</span>
      <span className="when">{formatDate(pb.updatedAt)}</span>
    </div>
  );
}

function RaidGroupRows({ group }: { group: PlayerRaidGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`pbt-brow raid${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)}>
        <span className="rank">#{group.summary.rank}</span>
        <PetIcon boss={group.summary.key} size="sm" />
        <span className="bname">
          <span className="caret" aria-hidden="true">▸</span>
          {group.heading}
        </span>
        <span className="time">
          {formatTime(group.summary.timeSeconds)}
          <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>({group.summary.label})</span>
        </span>
        <span className="when">{formatDate(group.summary.updatedAt)}</span>
      </button>
      {open &&
        group.variants.map((variant) => (
          <button type="button" className="pbt-sub" key={variant.key} style={{ cursor: 'default' }}>
            <span className="rank">#{variant.rank}</span>
            <span />
            <span className="variant">{variant.label}</span>
            <span className="time">{formatTime(variant.timeSeconds)}</span>
            <span className="when">{formatDate(variant.updatedAt)}</span>
          </button>
        ))}
    </>
  );
}
