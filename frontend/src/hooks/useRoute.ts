import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'leaderboards' }
  | { name: 'boss'; boss: string; highlight?: string }
  | { name: 'player'; player: string }
  | { name: 'about' }
  | { name: 'faq' }
  | { name: 'setup' };

export function routeFromPath(): Route {
  const rest = window.location.pathname;
  if (rest === '/about') return { name: 'about' };
  if (rest === '/faq') return { name: 'faq' };
  if (rest === '/setup') return { name: 'setup' };
  if (rest === '/leaderboards') return { name: 'leaderboards' };
  const playerMatch = rest.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = rest.match(/^\/boss\/(.+)$/);
  if (bossMatch) {
    const highlight = new URLSearchParams(window.location.search).get('highlight') ?? undefined;
    return { name: 'boss', boss: decodeURIComponent(bossMatch[1]), highlight };
  }
  return { name: 'home' };
}

function pathFromRoute(next: Route): string {
  switch (next.name) {
    case 'player':
      return `/player/${encodeURIComponent(next.player)}`;
    case 'boss':
      return `/boss/${encodeURIComponent(next.boss)}${next.highlight ? `?highlight=${encodeURIComponent(next.highlight)}` : ''}`;
    case 'about':
      return '/about';
    case 'faq':
      return '/faq';
    case 'setup':
      return '/setup';
    case 'leaderboards':
      return '/leaderboards';
    default:
      return '/';
  }
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(routeFromPath);

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next: Route) => {
    window.history.pushState({}, '', pathFromRoute(next));
    setRoute(next);
    // Each of these is its own "page" - switching between them (or between
    // two different bosses) should always land at the top, not wherever the
    // previous page happened to be scrolled to.
    window.scrollTo(0, 0);
  };

  return { route, navigate };
}
