import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { hideAmbiguousBaseEntries } from './lib/dedupe';
import { getRaidModes, isGroupedVariant } from './lib/bossGroups';
import { SearchBar } from './components/SearchBar';
import { BossComboboxCollapsed } from './components/BossComboboxCollapsed';
import { RaidVariantPicker } from './components/RaidVariantPicker';
import { PlayerResult } from './components/PlayerResult';
import { Leaderboard } from './components/Leaderboard';
import { QuickStats } from './components/QuickStats';
import { RecentSyncs } from './components/RecentSyncs';
import { EmptyState } from './components/States';
import { FaqPage } from './components/FaqPage';
import { SetupGuidePage } from './components/SetupGuidePage';
import { FeedbackButton } from './components/FeedbackButton';
import { PhaseTwoModernPreview } from './components/PhaseTwoModernPreview';

type View =
  | { name: 'home' }
  | { name: 'player'; player: string }
  | { name: 'boss'; boss: string; highlight?: string }
  | { name: 'faq' }
  | { name: 'setup' }
  | { name: 'phase2ModernPreview' };

function viewFromLocation(): View {
  const path = window.location.pathname;
  const playerMatch = path.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = path.match(/^\/boss\/(.+)$/);
  if (bossMatch) {
    const highlight = new URLSearchParams(window.location.search).get('highlight') ?? undefined;
    return { name: 'boss', boss: decodeURIComponent(bossMatch[1]), highlight };
  }
  if (path === '/faq') return { name: 'faq' };
  if (path === '/setup') return { name: 'setup' };
  if (path === '/phase-two-modern-preview' || path.startsWith('/phase-two-modern-preview/')) return { name: 'phase2ModernPreview' };
  return { name: 'home' };
}

// Short freeform tag sent along with feedback so we know roughly where the
// user was - not a lookup key, purely context for triage.
function feedbackContext(view: View): string {
  switch (view.name) {
    case 'player':
      return `player:${view.player}`;
    case 'boss':
      return `boss:${view.boss}`;
    case 'faq':
      return 'page:faq';
    case 'setup':
      return 'page:setup';
    case 'phase2ModernPreview':
      return 'page:phase-two-modern-preview';
    default:
      return 'page:home';
  }
}

export default function App() {
  const [view, setView] = useState<View>(viewFromLocation);
  const [bosses, setBosses] = useState<string[]>([]);

  useEffect(() => {
    api
      .getBosses()
      .then((all) => setBosses(hideAmbiguousBaseEntries(all, (b) => b)))
      .catch(() => setBosses([]));
  }, []);

  useEffect(() => {
    const onPop = () => setView(viewFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next: View) => {
    const path =
      next.name === 'player'
        ? `/player/${encodeURIComponent(next.player)}`
        : next.name === 'boss'
          ? `/boss/${encodeURIComponent(next.boss)}${next.highlight ? `?highlight=${encodeURIComponent(next.highlight)}` : ''}`
          : next.name === 'faq'
            ? '/faq'
            : next.name === 'setup'
              ? '/setup'
              : next.name === 'phase2ModernPreview'
                ? '/phase-two-modern-preview'
              : '/';
    window.history.pushState({}, '', path);
    setView(next);
  };

  if (view.name === 'phase2ModernPreview') {
    return (
      <main className="phase2-modern-page">
        <PhaseTwoModernPreview />
      </main>
    );
  }

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <a
            href="/"
            className="logo-link"
            onClick={(e) => {
              e.preventDefault();
              navigate({ name: 'home' });
            }}
          >
            <h1>
              <span className="accent">PB</span> Tracker
            </h1>
          </a>
          <p className="subtitle">Old School RuneScape boss personal best records</p>
        </div>
      </header>

      <main className="wrap">
        {view.name === 'faq' ? (
          <FaqPage />
        ) : view.name === 'setup' ? (
          <SetupGuidePage />
        ) : (
          <>
            <SearchBar
              key={view.name === 'player' ? view.player : 'blank'}
              initialValue={view.name === 'player' ? view.player : ''}
              onSubmit={(name) => navigate({ name: 'player', player: name })}
            />

            <section className="boss-select-card">
              <label>Or browse a leaderboard</label>
              <BossComboboxCollapsed
                bosses={bosses}
                selected={view.name === 'boss' ? view.boss : undefined}
                onSelect={(boss) => navigate({ name: 'boss', boss })}
                onSelectRaidBase={(base) => {
                  const modes = getRaidModes(bosses, base);
                  const firstKey = modes[0]?.variants[0]?.key;
                  if (firstKey) navigate({ name: 'boss', boss: firstKey });
                }}
              />
            </section>

            <section id="results">
              {view.name === 'home' && (
                <>
                  <EmptyState>
                    Search a player above, or pick a boss to see the leaderboard. Data appears
                    after a player syncs with the PB Tracker Sync RuneLite plugin. New here?{' '}
                    <a
                      href="/setup"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate({ name: 'setup' });
                      }}
                    >
                      See how to set it up
                    </a>
                    .
                  </EmptyState>
                  <QuickStats />
                  <RecentSyncs onPickPlayer={(player) => navigate({ name: 'player', player })} />
                </>
              )}
              {view.name === 'player' && (
                <PlayerResult
                  name={view.player}
                  onFaqClick={() => navigate({ name: 'faq' })}
                  onRankClick={(boss) => navigate({ name: 'boss', boss, highlight: view.player })}
                />
              )}
              {view.name === 'boss' && (
                <>
                  {isGroupedVariant(view.boss) && (
                    <RaidVariantPicker
                      base={view.boss.split(' - ')[0]}
                      bosses={bosses}
                      selected={view.boss}
                      onSelect={(key) => navigate({ name: 'boss', boss: key })}
                    />
                  )}
                  <Leaderboard boss={view.boss} highlight={view.highlight} />
                </>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          Data synced from the <strong>PB Tracker Sync</strong> RuneLite plugin. -{' '}
          <a
            href="/setup"
            onClick={(e) => {
              e.preventDefault();
              navigate({ name: 'setup' });
            }}
          >
            How to Setup
          </a>{' '}
          -{' '}
          <a
            href="/faq"
            onClick={(e) => {
              e.preventDefault();
              navigate({ name: 'faq' });
            }}
          >
            FAQ
          </a>
        </div>
      </footer>

      <div className="feedback-widget">
        <FeedbackButton context={feedbackContext(view)} />
      </div>
    </>
  );
}
