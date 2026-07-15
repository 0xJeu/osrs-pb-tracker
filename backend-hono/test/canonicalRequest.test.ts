import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { redirectToCanonicalGet } from '../src/lib/canonicalRequest.js';

function canonicalApp() {
  const app = new Hono();
  app.get('*', (c) => {
    const redirect = redirectToCanonicalGet(c, '/api/stats');
    return redirect ?? c.text('ok');
  });
  return app;
}

describe('redirectToCanonicalGet', () => {
  it('accepts Vercel\'s internally appended trailing slash', async () => {
    const response = await canonicalApp().request('/api/stats/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('still removes ignored query parameters', async () => {
    const response = await canonicalApp().request('/api/stats/?utm_source=test');
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe('/api/stats');
  });
});
