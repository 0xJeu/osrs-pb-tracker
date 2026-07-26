import { CSSProperties, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import '../theme-osrs-preview.css';
import type { LeaderboardPage, LeaderboardRow, QuickStats, RecentSync } from '../lib/api';
import { bossTitleParts, formatDate, formatTime, titleCase } from '../lib/format';
import { bossMonogram, useBossPetIconUrl } from '../lib/bossPetIcons';
import { bossAccentColor } from '../lib/bossColors';
import { bossSearchAlias } from '../lib/bossAliases';
import { BossView } from './BossView';
import { PlayerView } from './PlayerView';
import { AboutPage } from './AboutPage';
import { FaqPage } from './FaqPage';
import { SetupGuidePage } from './SetupGuidePage';
import { isLoaded, type LoadState } from '../lib/loadState';
import { useRoute } from '../hooks/useRoute';
import { useBossList } from '../hooks/useBossList';
import { pickInitialBoss, useBossLeaderboard } from '../hooks/useBossLeaderboard';
import { useHomeData } from '../hooks/useHomeData';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { useSearchSuggestions, compactAliasSuggestions } from '../hooks/useSearchSuggestions';

const DONATE_URL = import.meta.env.VITE_DONATE_URL as string | undefined;

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

function statValue(value: number | undefined) {
  const numberFormatter = new Intl.NumberFormat();
  return value === undefined ? '...' : numberFormatter.format(value);
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
  const { route, navigate } = useRoute();
  const bosses = useBossList(route);
  const { stats, recentSyncs, topBosses } = useHomeData(route);
  const profileState = usePlayerProfile(route);

  const bossLeaderboard = useBossLeaderboard(route, bosses);
  const { selectedBoss, leaderboard, rows, leaderboardOffset, setLeaderboardOffset, titleParts, highlight } = bossLeaderboard;

  const lookupPlayer = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    navigate({ name: 'player', player: trimmed });
  };

  // Only tint the page while actually looking at a boss's leaderboard - Home
  // and player pages stay neutral so the accent reads as "this page is about
  // this boss," not just "whatever was last clicked."
  const accentColor = route.name === 'boss' && selectedBoss ? bossAccentColor(selectedBoss) : undefined;
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
            <button type="button" className={route.name === 'home' ? 'active' : undefined} onClick={() => navigate({ name: 'home' })}>
              Home
            </button>
            <button type="button" className={route.name === 'setup' ? 'active' : undefined} onClick={() => navigate({ name: 'setup' })}>
              Setup
            </button>
            <button type="button" className={route.name === 'faq' ? 'active' : undefined} onClick={() => navigate({ name: 'faq' })}>
              FAQ
            </button>
            <button type="button" className={route.name === 'about' ? 'active' : undefined} onClick={() => navigate({ name: 'about' })}>
              About
            </button>
            <button
              type="button"
              className={route.name === 'boss' ? 'active' : undefined}
              onClick={() => goToBoss(selectedBoss || pickInitialBoss(isLoaded(bosses) ? bosses.data : []))}
            >
              Leaderboards
            </button>
          </nav>
        </div>
      </div>

      <div className="pbt-page">
        {route.name === 'home' && (
          <HomeView
            stats={stats}
            recentSyncs={recentSyncs}
            topBosses={topBosses}
            bosses={bosses}
            lookupPlayer={lookupPlayer}
            goToBoss={goToBoss}
          />
        )}
        {route.name === 'boss' && (
          <BossView
            titleParts={titleParts}
            bosses={bosses}
            selectedBoss={selectedBoss}
            highlight={highlight}
            goToBoss={goToBoss}
            navigate={navigate}
            leaderboard={leaderboard}
            setLeaderboardOffset={setLeaderboardOffset}
            rows={rows}
            lookupPlayer={lookupPlayer}
          />
        )}
        {route.name === 'player' && <PlayerView state={profileState} navigate={navigate} />}
        {route.name === 'about' && <AboutPage />}
        {route.name === 'faq' && <FaqPage />}
        {route.name === 'setup' && <SetupGuidePage />}
      </div>

      <div className="pbt-footer">
        <div className="pbt-footer-inner">
          <span>PB Tracker by Zenyte Labs — community boss personal-best leaderboards.</span>
          {DONATE_URL && (
            <a className="pbt-donate" href={DONATE_URL} target="_blank" rel="noreferrer">Donate</a>
          )}
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
  lookupPlayer,
  goToBoss,
}: {
  stats: LoadState<QuickStats>;
  recentSyncs: LoadState<RecentSync[]>;
  topBosses: LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>;
  bosses: LoadState<string[]>;
  lookupPlayer: (name: string) => void;
  goToBoss: (boss: string) => void;
}) {
  const [playerQuery, setPlayerQuery] = useState('');
  const suggestions = useSearchSuggestions(playerQuery, bosses);

  // Defensive: navigating to a player normally unmounts HomeView (a
  // different route.name branch renders instead), which already discards
  // playerQuery for free. This clears the box immediately in case that
  // ever stops being true - safe to leave even though it's currently
  // unreachable in practice.
  const submitLookup = (name: string) => {
    setPlayerQuery('');
    lookupPlayer(name);
  };

  const onPlayerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const alias = bossSearchAlias(playerQuery);
    const aliasSuggestions = alias && isLoaded(bosses) ? compactAliasSuggestions(playerQuery, bosses.data) : undefined;
    const aliasBoss = aliasSuggestions?.[0]?.value;
    const exactBoss = suggestions.find(
      (suggestion) => suggestion.type === 'boss' && normalize(suggestion.value) === normalize(playerQuery)
    );
    if (aliasBoss) goToBoss(aliasBoss);
    else if (exactBoss) goToBoss(exactBoss.value);
    else submitLookup(playerQuery);
  };

  return (
    <>
      <div className="pbt-section" style={{ paddingTop: 56 }}>
        <div className="pbt-kicker">
          <span>Gamewide personal-best leaderboards</span>
          <span className="rule" />
        </div>
        <h1 className="pbt-display pbt-h1">Find your next personal best.</h1>

        <form onSubmit={onPlayerSubmit} style={{ marginTop: 36 }}>
          <div className="pbt-searchband">
            <input
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              placeholder="Search players or bosses"
              aria-label="Search players or bosses"
              autoComplete="off"
            />
            <button type="submit">Search</button>
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="pbt-suggestions">
            {suggestions.slice(0, 10).map((suggestion) => (
              <button
                key={`${suggestion.type}:${suggestion.value}`}
                type="button"
                onClick={() => suggestion.type === 'boss' ? goToBoss(suggestion.value) : submitLookup(suggestion.value)}
              >
                <span className="pbt-suggestion-type">{suggestion.type}</span>
                {suggestion.label ?? titleCase(suggestion.value)}
              </button>
            ))}
          </div>
        )}

        <div className="pbt-stats pbt-stats-single">
          <div className="pbt-stat">
            <span className="num">{isLoaded(stats) ? statValue(stats.data.trackedPlayers) : stats.s === 'error' ? '—' : '...'}</span>
            <div className="lbl">Tracked players</div>
            <span className="idx">01</span>
          </div>
        </div>
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Top bosses</h2>
          <div className="rule" />
        </div>
        {topBosses.s === 'loading' && <div className="pbt-panel-state">Loading top bosses...</div>}
        {topBosses.s === 'error' && <div className="pbt-panel-state">Top bosses unavailable.</div>}
        {isLoaded(topBosses) && (
          <div className="pbt-cards">
            {topBosses.data.map((entry, index) => (
              <button type="button" className="pbt-card" key={entry.boss} onClick={() => goToBoss(entry.boss)}>
                <span className="idx">{String(index + 1).padStart(2, '0')}</span>
                <PetIcon boss={entry.boss} size="lg" />
                <div className="bname">{bossTitleParts(entry.boss).primary}</div>
                {entry.leader ? (
                  <>
                    <div className="btime">{formatTime(entry.leader.timeSeconds)}</div>
                    <div className="brank">{entry.leader.displayName}</div>
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
              <button type="button" className="pbt-row" key={sync.id} onClick={() => submitLookup(sync.displayName)}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
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

