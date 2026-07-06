import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { hideAmbiguousBaseEntries } from './lib/dedupe';
import { getRaidModes, isGroupedVariant } from './lib/bossGroups';
import { SearchBar } from './components/SearchBar';
import { BossComboboxCollapsed } from './components/BossComboboxCollapsed';
import { RaidVariantPicker } from './components/RaidVariantPicker';
import { PlayerResult } from './components/PlayerResult';
import { Leaderboard } from './components/Leaderboard';
import { RecentSyncs } from './components/RecentSyncs';
import { EmptyState } from './components/States';
import { FaqPage } from './components/FaqPage';

type View =
  | { name: 'home' }
  | { name: 'player'; player: string }
  | { name: 'boss'; boss: string }
  | { name: 'faq' };

function viewFromLocation(): View {
  const path = window.location.pathname;
  const playerMatch = path.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = path.match(/^\/boss\/(.+)$/);
  if (bossMatch) return { name: 'boss', boss: decodeURIComponent(bossMatch[1]) };
  if (path === '/faq') return { name: 'faq' };
  return { name: 'home' };
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
          ? `/boss/${encodeURIComponent(next.boss)}`
          : next.name === 'faq'
            ? '/faq'
            : '/';
    window.history.pushState({}, '', path);
    setView(next);
  };

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
                    after a player syncs with the PB Tracker Sync RuneLite plugin.
                  </EmptyState>
                  <RecentSyncs onPickPlayer={(player) => navigate({ name: 'player', player })} />
                </>
              )}
              {view.name === 'player' && (
                <PlayerResult name={view.player} onFaqClick={() => navigate({ name: 'faq' })} />
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
                  <Leaderboard boss={view.boss} />
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
    </>
  );
}
