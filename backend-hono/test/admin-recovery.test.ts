import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  feedback,
  installRecoveryCandidates,
  installRecoveryEvents,
  personalBests,
  playerInstallCredentialEvents,
  playerInstallCredentials,
  recoveryAdminLoginLimits,
} from '../src/db/schema.js';
import { resetRecoveryAdminLoginLimiter } from '../src/lib/adminAuth.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { hashSecret } from '../src/lib/secret.js';
import { resetSyncReplayCache } from '../src/lib/syncReplay.js';
import { truncateAll } from './helpers.js';

const adminPassword = 'recovery-admin-test-password-0001';
const incumbentSecret = 'a'.repeat(20);
const candidateSecret = 'b'.repeat(20);
const competingSecret = 'c'.repeat(20);

function sessionHeaders(cookie: string) {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
  };
}

async function login(
  password = adminPassword,
  username = 'admin',
  forwardedFor = '127.0.0.1',
  vercelForwardedFor?: string
) {
  const response = await app.request('/api/admin/recovery/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': forwardedFor,
      ...(vercelForwardedFor ? { 'x-vercel-forwarded-for': vercelForwardedFor } : {}),
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
    await resetSyncReplayCache();
    await truncateAll();
    resetRateLimiter();
    await resetRecoveryAdminLoginLimiter();
  });

  it('serves a data-free admin shell with restrictive browser headers', async () => {
    const response = await app.request('/api/admin/recovery');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(html).toContain('PB Tracker Admin');
    expect(html).toContain('PB Tracker admin login');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('Install recovery');
    expect(html).toContain('Feedback');
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
    const missingFeedback = await app.request('/api/admin/recovery/feedback');
    const { cookie } = await login(adminPassword, 'admin', '127.0.0.4');
    const tampered = await app.request('/api/admin/recovery/candidates', {
      headers: sessionHeaders(`${cookie}x`),
    });

    expect(missing.status).toBe(401);
    expect(missingFeedback.status).toBe(401);
    expect(tampered.status).toBe(401);
  });

  it('lists every feedback submission newest first without account identifiers', async () => {
    const older = new Date('2026-08-01T12:00:00.000Z');
    const newer = new Date('2026-08-02T12:00:00.000Z');
    await db.insert(feedback).values([
      { message: 'Older general feedback.', context: null, createdAt: older },
      { message: 'The Zulrah time looks wrong.', context: 'boss:zulrah', createdAt: newer },
    ]);
    const { cookie } = await login();

    const response = await app.request('/api/admin/recovery/feedback', {
      headers: sessionHeaders(cookie),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({
      feedback: [
        {
          id: expect.any(Number),
          message: 'The Zulrah time looks wrong.',
          context: 'boss:zulrah',
          createdAt: newer.toISOString(),
        },
        {
          id: expect.any(Number),
          message: 'Older general feedback.',
          context: null,
          createdAt: older.toISOString(),
        },
      ],
    });
  });

  it('rate-limits repeated failed logins without blocking a different source', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login('wrong-password-value', 'admin', '192.0.2.1')).response.status).toBe(401);
    }
    expect((await login(adminPassword, 'admin', '192.0.2.1')).response.status).toBe(429);
    expect((await login(adminPassword, 'admin', '192.0.2.2')).response.status).toBe(200);

    const [persistedLimit] = await db.select().from(recoveryAdminLoginLimits);
    expect(persistedLimit.failureCount).toBe(6);
    expect(persistedLimit.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedLimit.keyHash).not.toContain('192.0.2.1');
  });

  it('atomically limits parallel login guesses from one source', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 20 }, () => login('wrong-password-value', 'admin', '192.0.2.70'))
    );
    const statuses = attempts.map(({ response }) => response.status);

    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(15);
    const [persistedLimit] = await db.select().from(recoveryAdminLoginLimits);
    expect(persistedLimit.failureCount).toBe(6);
  });

  it('prunes expired login limiter keys while reserving a new attempt', async () => {
    await db.insert(recoveryAdminLoginLimits).values({
      keyHash: 'f'.repeat(64),
      failureCount: 5,
      windowStartedAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    expect((await login(adminPassword, 'admin', '192.0.2.71')).response.status).toBe(200);

    expect(await db.select().from(recoveryAdminLoginLimits)).toHaveLength(0);
  });

  it('uses Vercel\'s platform identity instead of a caller-controlled forwarded chain', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const spoofedForwardedFor = `198.51.100.${attempt + 1}`;
      expect(
        (await login('wrong-password-value', 'admin', spoofedForwardedFor, '192.0.2.50')).response.status
      ).toBe(401);
    }

    const blocked = await login(adminPassword, 'admin', '203.0.113.99', '192.0.2.50');
    expect(blocked.response.status).toBe(429);
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
    await db.insert(feedback).values({
      message: 'I reinstalled RuneLite and need help restoring sync.',
      context: `recovery:${recoveryId}`,
      createdAt: new Date(),
    });
    await db.insert(feedback).values({
      message: 'Unrelated site feedback.',
      context: 'page:home',
      createdAt: new Date(),
    });
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
      activeInstallCount: 1,
      installations: [
        expect.objectContaining({ status: 'active', source: 'initial_sync' }),
      ],
      equalCount: 1,
      improvedCount: 1,
      newCount: 1,
      assessment: {
        why: { code: 'INSTALL_CREDENTIAL_MISMATCH' },
        continuity: { level: 'strong', coveragePercent: 100 },
        recommendation: { action: 'verify_or_wait', tone: 'caution' },
        promotionEffect: { wouldChangeCount: 2 },
        lane: 'investigate',
      },
      events: [],
      supportMessages: [
        {
          message: 'I reinstalled RuneLite and need help restoring sync.',
          createdAt: expect.any(String),
        },
      ],
    });
    expect(body.candidates[0].assessment.lastAcceptedSyncAt).toEqual(expect.any(String));
    expect(body.candidates[0].assessment.limitation).toContain('not ownership');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SecretHash');
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('Digest');
    expect(serialized).not.toContain(hashSecret(incumbentSecret));
    expect(serialized).not.toContain(hashSecret(candidateSecret));
  });

  it('looks up an exact recovery ID regardless of the current status filter', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request(`/api/admin/recovery/candidates?status=rejected&id=${recoveryId}`, {
      headers: sessionHeaders(cookie),
    });

    expect(response.status).toBe(200);
    expect((await response.json()).candidates).toEqual([
      expect.objectContaining({ id: recoveryId, status: 'pending' }),
    ]);

    const invalid = await app.request('/api/admin/recovery/candidates?id=12oops', {
      headers: sessionHeaders(cookie),
    });
    expect(invalid.status).toBe(400);
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
      changedPbCount: 0,
      authorizationMode: 'additional',
      revokedInstallCount: 0,
    });
    expect(JSON.stringify(responseBody)).not.toContain('changedBosses');

    const accepted = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(accepted.status).toBe(200);
    const [event] = await db.select().from(installRecoveryEvents);
    expect(event).toMatchObject({
      candidateId: recoveryId,
      eventType: 'authorized_additional',
      actor: 'admin',
      reason: 'Verified local recovery test.',
    });

    const list = await app.request('/api/admin/recovery/candidates?status=all', {
      headers: sessionHeaders(cookie),
    });
    const listed = await list.json();
    expect(listed.candidates[0].events[0]).toMatchObject({
      eventType: 'authorized_additional',
      actor: 'admin',
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

  it('keeps rejection stable until an explicit audited reopen and approval', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const reject = await app.request(`/api/admin/recovery/candidates/${recoveryId}/reject`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Mistaken rejection reversal test.' }),
    });
    expect(reject.status).toBe(200);
    expect(await (await syncRequest(candidateSecret, { Zulrah: 74 })).json()).toMatchObject({
      code: 'RECOVERY_REJECTED',
      recoveryId,
    });

    const reopen = await app.request(`/api/admin/recovery/candidates/${recoveryId}/reopen`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Operator confirmed the rejection was mistaken.' }),
    });
    expect(reopen.status).toBe(200);
    expect(await reopen.json()).toMatchObject({ decision: 'reopen', status: 'pending' });
    expect(await (await syncRequest(candidateSecret, { Zulrah: 74 })).json()).toMatchObject({
      code: 'RECOVERY_PENDING',
      recoveryId,
    });

    const approve = await app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Approve after explicit second review.' }),
    });
    expect(approve.status).toBe(200);
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);

    const events = await db
      .select({ eventType: installRecoveryEvents.eventType })
      .from(installRecoveryEvents)
      .where(eq(installRecoveryEvents.candidateId, recoveryId))
      .orderBy(installRecoveryEvents.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'rejected',
      'reopened',
      'authorized_additional',
    ]);
  });

  it('reopens into contested review when another unknown credential is active', async () => {
    const rejectedId = await createCandidate();
    const { cookie } = await login();
    await app.request(`/api/admin/recovery/candidates/${rejectedId}/reject`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Prepare rejected candidate for contest test.' }),
    });
    const competing = await syncRequest(competingSecret, { Zulrah: 74 });
    expect((await competing.json()).code).toBe('RECOVERY_PENDING');

    const reopen = await app.request(`/api/admin/recovery/candidates/${rejectedId}/reopen`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Reopen while a competing credential exists.' }),
    });
    expect(reopen.status).toBe(200);
    expect(await reopen.json()).toMatchObject({ status: 'contested' });
    const statuses = await db
      .select({ status: installRecoveryCandidates.status })
      .from(installRecoveryCandidates)
      .orderBy(installRecoveryCandidates.id);
    expect(statuses).toEqual([{ status: 'contested' }, { status: 'contested' }]);
  });

  it('revokes and explicitly reactivates one installation through safe admin IDs', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const promote = await app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Authorize second machine for route test.' }),
    });
    expect(promote.status).toBe(200);
    const [candidateInstall] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.source, 'recovery_additional'));

    const revoke = await app.request(
      `/api/admin/recovery/candidates/installations/${candidateInstall.id}/revoke`,
      {
        method: 'POST',
        headers: sessionHeaders(cookie),
        body: JSON.stringify({ reason: 'Machine reported lost by operator.' }),
      }
    );
    expect(revoke.status).toBe(200);
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(409);

    const reactivate = await app.request(
      `/api/admin/recovery/candidates/installations/${candidateInstall.id}/reactivate`,
      {
        method: 'POST',
        headers: sessionHeaders(cookie),
        body: JSON.stringify({ reason: 'Machine was recovered and verified.' }),
      }
    );
    expect(reactivate.status).toBe(200);
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);
    const audit = await db
      .select({ eventType: playerInstallCredentialEvents.eventType })
      .from(playerInstallCredentialEvents)
      .where(eq(playerInstallCredentialEvents.credentialId, candidateInstall.id))
      .orderBy(playerInstallCredentialEvents.id);
    expect(audit.map((event) => event.eventType)).toEqual([
      'authorized_additional',
      'revoked',
      'reactivated',
    ]);
  });

  it('finds and manages installations after the recovery candidate is pruned', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    expect((await app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Authorize second machine before retention cleanup.' }),
    })).status).toBe(200);

    const [additionalInstall] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.source, 'recovery_additional'));
    await db.delete(installRecoveryCandidates);
    expect(await db.select().from(installRecoveryCandidates)).toHaveLength(0);

    const byName = await app.request(
      '/api/admin/recovery/installations?displayName=0xSteph%20Admin',
      { headers: sessionHeaders(cookie) }
    );
    expect(byName.status).toBe(200);
    const body = await byName.json();
    expect(body.players).toEqual([
      expect.objectContaining({
        playerId: additionalInstall.playerId,
        displayName: '0xSteph Admin',
        activeInstallCount: 2,
        installations: expect.arrayContaining([
          expect.objectContaining({ id: additionalInstall.id, status: 'active', source: 'recovery_additional' }),
        ]),
      }),
    ]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('accountHash');
    expect(serialized).not.toContain('SecretHash');
    expect(serialized).not.toContain('payload');
    expect(serialized).not.toContain('Digest');
    expect(serialized).not.toContain(hashSecret(incumbentSecret));
    expect(serialized).not.toContain(hashSecret(candidateSecret));

    const byId = await app.request(
      `/api/admin/recovery/installations?playerId=${additionalInstall.playerId}`,
      { headers: sessionHeaders(cookie) }
    );
    expect(byId.status).toBe(200);
    expect((await byId.json()).players).toHaveLength(1);

    const revoke = await app.request(
      `/api/admin/recovery/installations/${additionalInstall.id}/revoke`,
      {
        method: 'POST',
        headers: sessionHeaders(cookie),
        body: JSON.stringify({ reason: 'Revoke retained installation after candidate pruning.' }),
      }
    );
    expect(revoke.status).toBe(200);
    const rejectedRetry = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(rejectedRetry.status).toBe(409);
    expect(await rejectedRetry.json()).toMatchObject({
      code: 'RECOVERY_REJECTED',
      recoveryId: null,
    });
    expect(await db.select().from(installRecoveryCandidates)).toHaveLength(0);

    const reactivate = await app.request(
      `/api/admin/recovery/installations/${additionalInstall.id}/reactivate`,
      {
        method: 'POST',
        headers: sessionHeaders(cookie),
        body: JSON.stringify({ reason: 'Reactivate retained installation after operator review.' }),
      }
    );
    expect(reactivate.status).toBe(200);
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);
  });

  it('authenticates and validates standalone installation lookup', async () => {
    const unauthorized = await app.request('/api/admin/recovery/installations?playerId=1');
    expect(unauthorized.status).toBe(401);

    const { cookie } = await login();
    const headers = sessionHeaders(cookie);
    expect((await app.request('/api/admin/recovery/installations', { headers })).status).toBe(400);
    expect((await app.request('/api/admin/recovery/installations?playerId=oops', { headers })).status).toBe(400);
    expect((await app.request('/api/admin/recovery/installations?playerId=1&displayName=Somebody', { headers })).status).toBe(400);
  });

  it('requires a separate explicit replace-all action for security recovery', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request(`/api/admin/recovery/candidates/${recoveryId}/replace`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Confirmed compromise requires replacement.' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: 'replace',
      authorizationMode: 'replace',
      revokedInstallCount: 1,
      changedPbCount: 0,
    });
    expect((await syncRequest(incumbentSecret, { Zulrah: 70 })).status).toBe(409);
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);
  });

  it('resolves a contested epoch without changing credentials, then requires separate promotion', async () => {
    const recoveryId = await createCandidate();
    const competing = await syncRequest(competingSecret, { Zulrah: 74, Vorkath: 70 });
    expect(competing.status).toBe(409);
    const competingId = (await competing.json()).recoveryId as number;

    const { cookie } = await login();
    const resolution = await app.request(`/api/admin/recovery/candidates/${recoveryId}/resolve`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Player supplied candidate ID through the recovery support page.' }),
    });

    expect(resolution.status).toBe(200);
    expect(await resolution.json()).toMatchObject({
      ok: true,
      decision: 'resolve',
      candidateId: recoveryId,
      rejectedCompetitorCount: 1,
    });

    const candidates = await db.select().from(installRecoveryCandidates);
    expect(candidates.find((candidate) => candidate.id === recoveryId)?.status).toBe('pending');
    expect(candidates.find((candidate) => candidate.id === competingId)?.status).toBe('rejected');

    const events = await db.select().from(installRecoveryEvents);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: recoveryId, eventType: 'contest_resolved' }),
      expect.objectContaining({ candidateId: competingId, eventType: 'contest_competitor_rejected' }),
    ]));

    const beforePromotion = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(await beforePromotion.json()).toMatchObject({
      code: 'RECOVERY_PENDING',
      recoveryId,
    });

    const promotion = await app.request(`/api/admin/recovery/candidates/${recoveryId}/promote`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Second explicit decision after contest resolution.' }),
    });
    expect(promotion.status).toBe(200);
    expect((await syncRequest(candidateSecret, { Zulrah: 73 })).status).toBe(200);
    expect((await syncRequest(competingSecret, { Zulrah: 72 })).status).toBe(409);
  });

  it('refuses to resolve a candidate that is not contested', async () => {
    const recoveryId = await createCandidate();
    const { cookie } = await login();
    const response = await app.request(`/api/admin/recovery/candidates/${recoveryId}/resolve`, {
      method: 'POST',
      headers: sessionHeaders(cookie),
      body: JSON.stringify({ reason: 'Should remain pending and unchanged.' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'RECOVERY_DECISION_CONFLICT' });
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
