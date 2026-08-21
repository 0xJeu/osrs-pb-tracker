// Ported from website/app.js so the rewrite renders times and dates
// identically to the prototype users already know.

export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const hasFraction = Math.abs(s - Math.round(s)) > 0.001;
  const secStr = hasFraction
    ? s.toFixed(2).padStart(5, '0')
    : String(Math.round(s)).padStart(2, '0');

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${secStr}`;
  }
  return `${m}:${secStr}`;
}

// Doom of Mokhaiotl's deepest delve record is a depth level, not a duration
// - it's read off the boss's in-game scoreboard, not a fight-timer PB. Keep
// this in sync with backend-hono's HIGHER_IS_BETTER_BOSSES.
export const DEEPEST_DELVE_BOSS = 'doom of mokhaiotl deepest delve';

export function isDeepestDelveBoss(boss: string): boolean {
  return boss.trim().toLowerCase() === DEEPEST_DELVE_BOSS;
}

export function formatPbValue(boss: string, value: number): string {
  return isDeepestDelveBoss(boss) ? `Delve ${Math.round(value)}` : formatTime(value);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function titleCase(str: string): string {
  return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}

export function bossTitleParts(boss: string) {
  const [first, ...rest] = titleCase(boss).split(' - ');
  return { primary: first || 'Loading Leaderboard', secondary: rest.join(' - ') };
}
