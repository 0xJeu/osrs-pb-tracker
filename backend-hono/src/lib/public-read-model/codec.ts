import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
  brotliCompress,
  brotliDecompress,
  constants as zlibConstants,
} from 'node:zlib';
import { isPublicSnapshotV1, type PublicSnapshotV1 } from './schema.js';

const compress = promisify(brotliCompress);
const decompress = promisify(brotliDecompress);
const MAX_ENCODED_PAYLOAD_BYTES = 2_000_000;
const MAX_UNCOMPRESSED_PAYLOAD_BYTES = 20_000_000;

export interface StoredPublicSnapshotV1 {
  storageVersion: 1;
  schemaVersion: 1;
  revision: string;
  generatedAt: string;
  encoding: 'br+base64';
  checksum: string;
  uncompressedBytes: number;
  payload: string;
}

function checksum(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

export async function encodePublicSnapshot(
  snapshot: PublicSnapshotV1
): Promise<StoredPublicSnapshotV1> {
  const raw = Buffer.from(JSON.stringify(snapshot));
  if (raw.length > MAX_UNCOMPRESSED_PAYLOAD_BYTES) {
    throw new Error('Public snapshot exceeds the uncompressed size limit');
  }
  const encoded = await compress(raw, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
  });
  const stored = {
    storageVersion: 1,
    schemaVersion: 1,
    revision: snapshot.revision,
    generatedAt: snapshot.generatedAt,
    encoding: 'br+base64',
    checksum: checksum(raw),
    uncompressedBytes: raw.length,
    payload: encoded.toString('base64'),
  } satisfies StoredPublicSnapshotV1;
  if (Buffer.byteLength(stored.payload) > MAX_ENCODED_PAYLOAD_BYTES) {
    throw new Error('Public snapshot exceeds the encoded deployment limit');
  }
  return stored;
}

export async function decodePublicSnapshot(
  stored: StoredPublicSnapshotV1
): Promise<PublicSnapshotV1> {
  if (stored.storageVersion !== 1 || stored.schemaVersion !== 1 || stored.encoding !== 'br+base64') {
    throw new Error('Unsupported public snapshot storage format');
  }
  if (!Number.isSafeInteger(stored.uncompressedBytes)
    || stored.uncompressedBytes < 0
    || stored.uncompressedBytes > MAX_UNCOMPRESSED_PAYLOAD_BYTES
    || Buffer.byteLength(stored.payload) > MAX_ENCODED_PAYLOAD_BYTES) {
    throw new Error('Public snapshot exceeds safe decode limits');
  }
  const raw = await decompress(Buffer.from(stored.payload, 'base64'), {
    maxOutputLength: MAX_UNCOMPRESSED_PAYLOAD_BYTES,
  });
  if (raw.length !== stored.uncompressedBytes || checksum(raw) !== stored.checksum) {
    throw new Error('Public snapshot checksum or byte count mismatch');
  }
  const snapshot: unknown = JSON.parse(raw.toString('utf8'));
  if (!isPublicSnapshotV1(snapshot) || snapshot.revision !== stored.revision) {
    throw new Error('Public snapshot payload failed schema or revision validation');
  }
  return snapshot;
}
