import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { truncateAll } from './helpers.js';

function feedbackRequest(body: unknown, headers: Record<string, string> = {}) {
  return app.request('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/feedback', () => {
  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
  });

  it('rejects a missing message', async () => {
    const res = await feedbackRequest({});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/message/);
  });

  it('rejects a blank message', async () => {
    const res = await feedbackRequest({ message: '   ' });
    expect(res.status).toBe(400);
  });

  it('accepts a message with no context', async () => {
    const res = await feedbackRequest({ message: 'The Colosseum PB looks wrong for my account.' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cdn-cache-control')).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });

  it('accepts a message with context', async () => {
    const res = await feedbackRequest({
      message: 'Nightmare solo time never synced.',
      context: 'boss:the nightmare - solo',
    });
    expect(res.status).toBe(200);
  });

  it('trims and caps an overly long message instead of rejecting it', async () => {
    const res = await feedbackRequest({ message: 'x'.repeat(5000) });
    expect(res.status).toBe(200);
  });

  it('ignores a non-string context rather than erroring', async () => {
    const res = await feedbackRequest({ message: 'Works fine, just saying hi.', context: 12345 });
    expect(res.status).toBe(200);
  });

  it('rate-limits after too many submissions from the same source', async () => {
    for (let i = 0; i < 30; i += 1) {
      await feedbackRequest({ message: `report ${i}` }, { 'x-forwarded-for': '1.2.3.4' });
    }
    const res = await feedbackRequest({ message: 'one more' }, { 'x-forwarded-for': '1.2.3.4' });
    expect(res.status).toBe(429);
  });

  it('does not rate-limit different sources against each other', async () => {
    for (let i = 0; i < 30; i += 1) {
      await feedbackRequest({ message: `report ${i}` }, { 'x-forwarded-for': '1.2.3.4' });
    }
    const res = await feedbackRequest({ message: 'from someone else' }, { 'x-forwarded-for': '5.6.7.8' });
    expect(res.status).toBe(200);
  });
});
