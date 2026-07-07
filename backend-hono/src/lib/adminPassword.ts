import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Node's built-in scrypt: salted and deliberately slow, unlike the plain
// SHA-256 in lib/secret.ts (which is fine for a high-entropy generated
// install secret, but wrong for a human-chosen admin password).
const KEY_LENGTH = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(candidate, stored);
}
