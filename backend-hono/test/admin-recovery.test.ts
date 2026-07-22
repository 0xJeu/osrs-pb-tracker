import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { installRecoveryCandidates, installRecoveryEvents, personalBests } from '../src/db/schema.js';
import { resetRecoveryAdminLoginLimiter } from '../src/lib/adminAuth.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { truncateAll } from './helpers.js';

const adminPassword = 'recovery-admin-test-password-0001';
const incumbentSecret = 'a'.repeat(20);
const candidateSecret = 'b'.repeat(20);

function sessionHeaders(cookie: string) {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
  };
}

async function login(password = adminPassword, username = 'admin', forwardedFor = '127.0.0.1') {
  const response = await app.request('/api/admin/recovery/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': forwardedFor,
    },
    body: JSON.stringify({ username, password }),
  });
  const setCookie = response.headers.get('set-cookie');
  return {
    response,
    cookie: setCookie?.split(';')[0] ?? '',
    setCookie,
  };
}

function syncRequest(installSecret: string, pbs: Record<string, number>) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountHash: 'admin-recovery-account',
      displayName: '0xSteph Admin',
      installSecret,
      pbs,
    }),
  });
}

async function createCandidate() {
  expect((await syncRequest(incumbentSecret, { Zulrah: 80, Vorkath: 70 })).status).toBe(200);
  const mismatch = await syncRequest(candidateSecret, { Zulrah: 75, Vorkath: 70, Araxxor: 100 });
  expect(mismatch.status).toBe(409);
  return (await mismatch.json()).recoveryId as number;
}

describe('recovery admin', () => {
  beforeEach(async () => {
    process.env.RECOVERY_ADMIN_PASSWORD = adminPassword;
    await truncateAll();
    resetRateLimiter();
    resetRecoveryAdminLoginLimiter();
  });

  it('serves a data-free admin shell with restrictive browser headers', async () => {
    const response = await app.request('/api/admin/recovery');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(html).toContain('PB Tracker Recovery Admin');
    expect(html).toContain('Recovery admin login');
    expect(html).not.toContain(adminPassword);
  });

  it('keeps public API CORS enabled while excluding admin routes', async () => {
    const { cookie } = await login();
    const publicResponse = await app.request('/api/stats', {
      headers: { Origin: 'https://osrs-pb-tracker-frontend.vercel.app' },
    });
    const adminResponse = await app.request('/api/admin/recovery/candidates', {
      headers: {
        ...sessionHeaders(cookie),
        Origin: 'https://osrs-pb-tracker-frontend.vercel.app',
      },
    });

    expect(publicResponse.headers.get('access-control-allow-origin')).toBe('*');
    expect(adminResponse.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('fails closed when the admin password is not configured', async () => {
    delete process.env.RECOVERY_ADMIN_PASSWORD;
    const response = await app.request('/api/admin/recovery/candidates');
    const loginResponse = await login();

    expect(response.status).toBe(503);
    expect(loginResponse.response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Recovery admin is not configured.' });
  });

  it('creates a signed HttpOnly session for the fixed admin username', async () => {
    const { response, cookie, setCookie } = await login();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, username: 'admin' });
    expect(cookie).toMatch(/^pb_recovery_admin=v1\./);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/api/admin/recovery');
    expect(setCookie).not.toContain(adminPassword);

    const session = await app.request('/api/admin/recovery/session', {
      headers: sessionHeaders(cookie),
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({ authenticated: true, username: 'admin' });
  });

  it('rejects invalid credentials, missing sessions, and tampered cookies', async () => {
    const wrongUsername = await login(adminPassword, 'not-admin', '127.0.0.2');
    const wrongPassword = await login('definitely-the-wrong-password', 'admin', '127.0.0.3');
    expect(wrongUsername.response.status).toBe(401);
    expect(wrongPassword.response.status).toBe(401);
    expect(await wrongUsername.response.json()).toEqual({ error: 'Invalid username or password.' });

    const missing = await app.request('/api/admin/recovery/candidates');
    const { cookie } = await login(adminPassword, 'admin', '127.0.0.4');
    const tampered = await app.request('/api/admin/recovery/candidates', {
      headers: sessionHeaders(`${cookie}x`),
    });

    expect(missing.status).toBe(401);
    expect(tampered.status).toBe(401);
  });

  it('rate-limits repeated failed logins without blocking a different source', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login('wrong-password-value', 'admin', '192.0.2.1')).response.status).toBe(401);
    }
    expect((await login(adminPassword, 'admin', '192.0.2.1')).response.status).toBe(429);
    expect((await login(adminPassword, 'admin', '192.0.2.2')).response.status).toBe(200);
  });

  it('clears the browser session cookie on logout', async () => {
    const unauthorized = await app.request('/api/admin/recovery/logout', { method: 'POST' });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('set-cookie')).toBeNull();

    const { cookie } = await login();
    const response = await app.request('/api/admin/recovery/logout', {
      method: 'POST',
      headers: sessionHeaders(cookie),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('pb_recovery_admin=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('lists safe recovery metadata without hashes or quarantined PB payloads', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request('/api/admin/recovery/candidates?status=active', {
      headers: sessionHeaders(cookie),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      id: recoveryId,
      displayName: '0xSteph Admin',
      status: 'pending',
      equalCount: 1,
      improvedCount: 1,
      newCount: 1,
      assessment: {
        why: { code: 'INSTALL_CREDENTIAL_MISMATCH' },
        continuity: { level: 'strong', coveragePercent: 100 },
        recommendation: { action: 'verify_or_wait', tone: 'caution' },
        promotionEffect: { wouldChangeCount: 2 },
      },
      events: [],
    });
    expect(body.candidates[0].assessment.lastAcceptedSyncAt).toEqual(expect.any(String));
    expect(body.candidates[0].assessment.limitation).toContain('not ownership');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SecretHash');
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('Digest');
  });

  it('validates decision input before changing a candidate', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ actor: '0xSteph', reason: 'no' }),
    });

    expect(response.status).toBe(400);
    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('pending');
  });

  it('promotes a pending candidate and exposes only the safe audit event', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ actor: '0xSteph', reason: 'Verified local recovery test.' }),
    });

    expect(response.status).toBe(200);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({
      ok: true,
      decision: 'promote',
      candidateId: recoveryId,
      changedPbCount: 2,
    });
    expect(JSON.stringify(responseBody)).not.toContain('changedBosses');

    const accepted = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(accepted.status).toBe(200);
    const [event] = await db.select().from(installRecoveryEvents);
    expect(event).toMatchObject({
      candidateId: recoveryId,
      eventType: 'promoted',
      actor: '0xSteph',
      reason: 'Verified local recovery test.',
    });

    const list = await app.request('/api/admin/recovery/candidates?status=all', {
      headers: sessionHeaders(cookie),
    });
    const listed = await list.json();
    expect(listed.candidates[0].events[0]).toMatchObject({
      eventType: 'promoted',
      actor: '0xSteph',
      reason: 'Verified local recovery test.',
    });
  });

  it('rejects a candidate and preserves canonical PB data', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request(`/api/admin/recovery/candidates/${recoveryId}/reject`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ actor: '0xSteph', reason: 'Deliberate admin rejection test.' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      decision: 'reject',
      candidateId: recoveryId,
    });
    const [zulrah] = await db
      .select({ timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .where(eq(personalBests.boss, 'zulrah'));
    expect(zulrah.timeSeconds).toBe(80);

    const retried = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(await retried.json()).toMatchObject({
      code: 'RECOVERY_REJECTED',
      recoveryId,
    });
  });

  it('returns a decision conflict instead of repeating a promotion', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const request = () =>
      app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
        method: 'POST',
        headers: sessionHeaders(cookie),
        body: JSON.stringify({ actor: '0xSteph', reason: 'Exercise idempotent conflict behavior.' }),
      });

    expect((await request()).status).toBe(200);
    const repeated = await request();
    expect(repeated.status).toBe(409);
    expect(await repeated.json()).toMatchObject({ code: 'RECOVERY_DECISION_CONFLICT' });
  });
});
