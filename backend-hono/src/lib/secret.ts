import { createHash } from 'node:crypto';

// RuneLite gives plugins no way to cryptographically prove account identity
// to a third-party server. Instead of proving identity, the caller sends a
// per-install secret and we bind it to an accountHash on first sync (TOFU
// claim) - see routes/sync.ts. We only ever store/compare the hash, never
// the raw secret.
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const syncRequestTimestamps = new Map<string, number[]>();

// nowMs is injectable so tests can simulate the window passing without
// real sleeps.
export function isRateLimited(key: string, nowMs: number = Date.now()): boolean {
  const recent = (syncRequestTimestamps.get(key) ?? []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  recent.push(nowMs);
  syncRequestTimestamps.set(key, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

export function resetRateLimiter(): void {
  syncRequestTimestamps.clear();
}
