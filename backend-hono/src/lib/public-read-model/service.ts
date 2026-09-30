import { buildPublicSnapshot } from './build.js';
import { decodePublicSnapshot, encodePublicSnapshot } from './codec.js';
import { getPublicReadModelConfig } from './config.js';
import type { PublicSnapshotV1 } from './schema.js';
import {
  acquirePublicSnapshotRepairLock,
  publishStoredPublicSnapshot,
  readStoredPublicSnapshot,
  releasePublicSnapshotRepairLock,
  type PublishStoreResult,
} from './store.js';

export type PublicSnapshotPublishResult = PublishStoreResult | 'disabled' | 'failed' | 'locked';

let repairPromise: Promise<PublicSnapshotPublishResult> | null = null;

export async function readPublicSnapshot(): Promise<PublicSnapshotV1 | null> {
  const { mode } = getPublicReadModelConfig();
  if (mode === 'disabled') return null;
  try {
    const stored = await readStoredPublicSnapshot();
    if (!stored) return null;
    return await decodePublicSnapshot(stored);
  } catch (error) {
    console.warn('Public snapshot read failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return null;
  }
}

export async function readPrimaryPublicSnapshot(): Promise<PublicSnapshotV1 | null> {
  return getPublicReadModelConfig().mode === 'primary' ? readPublicSnapshot() : null;
}

export async function publishPublicSnapshot(): Promise<PublicSnapshotPublishResult> {
  if (getPublicReadModelConfig().mode === 'disabled') return 'disabled';
  try {
    const snapshot = await buildPublicSnapshot();
    const stored = await encodePublicSnapshot(snapshot);
    const result = await publishStoredPublicSnapshot(stored);
    console.info('Public snapshot publication', {
      result,
      revision: snapshot.revision,
      players: snapshot.sourceCounts.players,
      personalBests: snapshot.sourceCounts.personalBests,
      encodedBytes: Buffer.byteLength(JSON.stringify(stored)),
    });
    return result;
  } catch (error) {
    console.error('Public snapshot publication failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return 'failed';
  }
}

async function repairPublicSnapshot(): Promise<PublicSnapshotPublishResult> {
  const token = await acquirePublicSnapshotRepairLock().catch(() => null);
  if (!token) return 'locked';
  try {
    return await publishPublicSnapshot();
  } finally {
    await releasePublicSnapshotRepairLock(token).catch(() => undefined);
  }
}

export function schedulePublicSnapshotRepair() {
  if (getPublicReadModelConfig().mode !== 'primary') return;
  if (!repairPromise) {
    repairPromise = repairPublicSnapshot().finally(() => {
      repairPromise = null;
    });
  }
  const task = repairPromise;
  if (process.env.VERCEL) {
    void import('@vercel/functions')
      .then(({ waitUntil }) => waitUntil(task))
      .catch(() => undefined);
  }
}

export function resetPublicSnapshotServiceForTests() {
  repairPromise = null;
}
