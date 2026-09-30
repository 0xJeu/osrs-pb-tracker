import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { getPublicReadModelConfig } from './config.js';
import type { StoredPublicSnapshotV1 } from './codec.js';

const PUBLISH_SCRIPT = `
local function normalize(value)
  value = string.gsub(value, '^0+', '')
  if value == '' then return '0' end
  return value
end
local function is_greater(left, right)
  left = normalize(left)
  right = normalize(right)
  if string.len(left) ~= string.len(right) then
    return string.len(left) > string.len(right)
  end
  return left > right
end
local current = redis.call('GET', KEYS[1])
if current and not is_greater(ARGV[1], current) then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type PublishStoreResult = 'published' | 'stale-rejected' | 'unavailable';

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const config = getPublicReadModelConfig();
  if (!config.redisUrl || !config.redisToken) {
    redisClient = null;
    return null;
  }
  redisClient = new Redis({ url: config.redisUrl, token: config.redisToken });
  return redisClient;
}

function keys() {
  const { namespace } = getPublicReadModelConfig();
  return {
    snapshot: `${namespace}:public:snapshot`,
    revision: `${namespace}:public:revision`,
    repairLock: `${namespace}:public:repair-lock`,
  };
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  const { timeoutMs } = getPublicReadModelConfig();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readStoredPublicSnapshot(): Promise<StoredPublicSnapshotV1 | null> {
  const redis = getRedis();
  if (!redis) return null;
  const value = await withTimeout(redis.get<StoredPublicSnapshotV1 | string>(keys().snapshot));
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) as StoredPublicSnapshotV1 : value;
}

export async function publishStoredPublicSnapshot(
  value: StoredPublicSnapshotV1
): Promise<PublishStoreResult> {
  const redis = getRedis();
  if (!redis) return 'unavailable';
  const cacheKeys = keys();
  const result = await withTimeout(redis.eval<[string, string], number>(
    PUBLISH_SCRIPT,
    [cacheKeys.revision, cacheKeys.snapshot],
    [value.revision, JSON.stringify(value)]
  ));
  return Number(result) === 1 ? 'published' : 'stale-rejected';
}

export async function acquirePublicSnapshotRepairLock(): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  const token = randomUUID();
  const result = await withTimeout(redis.set(keys().repairLock, token, { nx: true, px: 30_000 }));
  return result === 'OK' ? token : null;
}

export async function releasePublicSnapshotRepairLock(token: string) {
  const redis = getRedis();
  if (!redis) return;
  await withTimeout(redis.eval<[string], number>(
    RELEASE_LOCK_SCRIPT,
    [keys().repairLock],
    [token]
  ));
}

export function resetPublicSnapshotStoreForTests() {
  redisClient = undefined;
}

export const publicSnapshotPublishScriptForTests = PUBLISH_SCRIPT;
