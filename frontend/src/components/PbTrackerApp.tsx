import { CSSProperties } from 'react';
import '../theme-osrs-preview.css';
import { bossAccentColor } from '../lib/bossColors';
import { BossView } from './BossView';
import { PlayerView } from './PlayerView';
import { HomeView } from './HomeView';
import { AboutPage } from './AboutPage';
import { FaqPage } from './FaqPage';
import { SetupGuidePage } from './SetupGuidePage';
import { isLoaded } from '../lib/loadState';
import { useRoute } from '../hooks/useRoute';
import { useBossList } from '../hooks/useBossList';
import { pickInitialBoss, useBossLeaderboard } from '../hooks/useBossLeaderboard';
import { useHomeData } from '../hooks/useHomeData';
import { usePlayerProfile } from '../hooks/usePlayerProfile';

const DONATE_URL = import.meta.env.VITE_DONATE_URL as string | undefined;

export function PbTrackerApp() {
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
          <nav className="pbt-nav" aria-label="Main navigation">
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
