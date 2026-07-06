import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { hideAmbiguousBaseEntries } from './lib/dedupe';
import { SearchBar } from './components/SearchBar';
import { BossCombobox } from './components/BossCombobox';
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
  const params = new URLSearchParams(window.location.search);
  const player = params.get('player');
  const boss = params.get('boss');
  const page = params.get('page');
  if (player) return { name: 'player', player };
  if (boss) return { name: 'boss', boss };
  if (page === 'faq') return { name: 'faq' };
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
    const url = new URL(window.location.href);
    url.search = '';
    if (next.name === 'player') url.searchParams.set('player', next.player);
    if (next.name === 'boss') url.searchParams.set('boss', next.boss);
    if (next.name === 'faq') url.searchParams.set('page', 'faq');
    window.history.pushState({}, '', url);
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
              <BossCombobox
                bosses={bosses}
                selected={view.name === 'boss' ? view.boss : undefined}
                onSelect={(boss) => navigate({ name: 'boss', boss })}
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
              {view.name === 'boss' && <Leaderboard boss={view.boss} />}
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <div className="wrap">
          Data synced from the <strong>PB Tracker Sync</strong> RuneLite plugin. -{' '}
          <a
            href="/?page=faq"
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
