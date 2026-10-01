import { createHash, randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { getPublicReadModelConfig } from './public-read-model/config.js';

// This store may only suppress requests. It must never authorize a credential
// or acknowledge an unprocessed sync. Upstash's eventual consistency is not
// sufficient for our immediate-revocation positive authorization contract.
export const NEGATIVE_CACHE_TTL_SECONDS = 300;
const MAX_ENTRIES = 2048;
type Kind = 'sync-denial' | 'player-missing';
export interface CachedSyncDenial {
  error: string;
  code: string;
  recoveryId: number | null;
  retryAfterSeconds: number | null;
  syncAttemptId: null;
}
interface Envelope {
  version: 1;
  generation: string;
  expiresAt: number;
  value: unknown;
}

export const negativeCacheScripts = {
  generation: `
local current = redis.call('GET', KEYS[1])
if current then return current end
redis.call('SET', KEYS[1], ARGV[1], 'NX')
return redis.call('GET', KEYS[1])`,
  read: `
local generation = redis.call('GET', KEYS[1])
local raw = redis.call('GET', KEYS[2])
if not generation or not raw then return nil end
local ok, entry = pcall(cjson.decode, raw)
if not ok or entry.generation ~= generation then return nil end
return raw`,
  publish: `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[3])
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[5]) and not redis.call('ZSCORE', KEYS[3], KEYS[2]) then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
redis.call('ZADD', KEYS[3], tonumber(ARGV[3]) + tonumber(ARGV[4]) * 1000, KEYS[2])
redis.call('EXPIRE', KEYS[3], ARGV[4])
return 1`,
};

let client: Redis | null | undefined;
function enabled(kind: Kind) {
  const flag = kind === 'sync-denial' ? 'SYNC_DENIAL_CACHE_ENABLED' : 'PUBLIC_NEGATIVE_CACHE_ENABLED';
  return process.env[flag] === 'true';
}
function redis() {
  if (client !== undefined) return client;
  const config = getPublicReadModelConfig();
  client = config.redisUrl && config.redisToken
    ? new Redis({ url: config.redisUrl, token: config.redisToken, automaticDeserialization: false,
      retry: { retries: 0 }, signal: () => AbortSignal.timeout(config.timeoutMs) })
    : null;
  return client;
}
function keys(kind: Kind, fingerprint: string) {
  const prefix = `${getPublicReadModelConfig().namespace}:negative:v1:${kind}`;
  return [`${prefix}:generation`, `${prefix}:${fingerprint}`, `${prefix}:entries`];
}
async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('negative cache timeout')), getPublicReadModelConfig().timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
let fallbackCount = 0;
let lastHitMetricAt = 0;
const hits = { 'sync-denial': 0, 'player-missing': 0 };
function noteHit(kind: Kind) {
  if (!process.env.VERCEL) return;
  hits[kind]++;
  if (Date.now() - lastHitMetricAt < 60_000) return;
  console.info('Negative cache fast paths active', {
    syncDenialHits: hits['sync-denial'], playerMissingHits: hits['player-missing'],
  });
  hits['sync-denial'] = hits['player-missing'] = 0;
  lastHitMetricAt = Date.now();
}
function fallback() {
  if (process.env.VERCEL && (++fallbackCount === 1 || fallbackCount % 100 === 0)) {
    console.warn('Negative cache unavailable; using database path', { fallbackCount });
  }
}
export function missingPlayerFingerprint(kind: 'id' | 'name', value: string) {
  return createHash('sha256').update(JSON.stringify(['player-missing-v1', kind, value])).digest('hex');
}

export async function readNegativeCache(kind: Kind, fingerprint: string): Promise<unknown | null> {
  if (!enabled(kind)) return null;
  try {
    const store = redis(); if (!store) return null;
    const raw = await bounded(store.eval<string[], string | null>(negativeCacheScripts.read, keys(kind, fingerprint), []));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Envelope;
    if (entry.version !== 1 || typeof entry.generation !== 'string'
      || !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt <= Date.now()
      || entry.expiresAt > Date.now() + NEGATIVE_CACHE_TTL_SECONDS * 1000) return null;
    if (kind === 'player-missing' && entry.value === true) noteHit(kind);
    return entry.value;
  } catch { fallback(); return null; }
}

// Capture before querying Neon. Publication is fenced against any intervening
// cache rotation, so a delayed lookup cannot refill the previous generation.
export async function beginNegativeCacheFill(kind: Kind): Promise<string | null> {
  if (!enabled(kind)) return null;
  try {
    const store = redis(); if (!store) return null;
    return await bounded(store.eval<string[], string>(negativeCacheScripts.generation, [keys(kind, '')[0]!], [randomUUID()]));
  } catch { fallback(); return null; }
}
export async function publishNegativeCache(kind: Kind, fingerprint: string, generation: string | null, value: unknown) {
  if (!generation || !enabled(kind)) return;
  try {
    const store = redis(); if (!store) return;
    const now = Date.now();
    const entry: Envelope = { version: 1, generation, expiresAt: now + NEGATIVE_CACHE_TTL_SECONDS * 1000, value };
    await bounded(store.eval(negativeCacheScripts.publish, keys(kind, fingerprint),
      [generation, JSON.stringify(entry), now, NEGATIVE_CACHE_TTL_SECONDS, MAX_ENTRIES]));
  } catch { fallback(); }
}

export async function invalidateNegativeCache(kind: Kind) {
  if (!enabled(kind)) return;
  try {
    const store = redis(); if (!store) return;
    await bounded(store.set(keys(kind, '')[0]!, randomUUID()));
  } catch { fallback(); }
}

export async function withDenialCacheInvalidation<T>(mutation: () => Promise<T>): Promise<T> {
  await invalidateNegativeCache('sync-denial');
  try { return await mutation(); }
  finally { await invalidateNegativeCache('sync-denial'); }
}
export async function readCachedSyncDenial(fingerprint: string): Promise<CachedSyncDenial | null> {
  const value = await readNegativeCache('sync-denial', fingerprint);
  if (!value || typeof value !== 'object') return null;
  const v = value as CachedSyncDenial;
  const codes = ['RECOVERY_REJECTED', 'RECOVERY_CONTESTED', 'RECOVERY_PENDING'];
  if (typeof v.error !== 'string' || !codes.includes(v.code) || v.syncAttemptId !== null
    || !(v.recoveryId === null || (Number.isSafeInteger(v.recoveryId) && v.recoveryId > 0))
    || !(v.retryAfterSeconds === null || (Number.isSafeInteger(v.retryAfterSeconds) && v.retryAfterSeconds > 0))) return null;
  noteHit('sync-denial');
  return v;
}
export function resetNegativeCacheForTests() {
  client = undefined; fallbackCount = lastHitMetricAt = 0;
  hits['sync-denial'] = hits['player-missing'] = 0;
}
