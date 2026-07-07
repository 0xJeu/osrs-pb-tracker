import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/adminPassword.js';

describe('adminPassword', () => {
  it('verifies a correct password against its hash', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash, salt)).toBe(false);
  });

  it('uses a different salt (and resulting hash) on every call', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('rejects a password checked against the wrong salt', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(verifyPassword('same password', a.hash, b.salt)).toBe(false);
  });
});
