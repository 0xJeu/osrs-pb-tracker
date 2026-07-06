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

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function titleCase(str: string): string {
  return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}
