import { describe, expect, it } from 'vitest';
import { handler } from '../api/handler.js';
import candidateActionHandler from '../api/admin/recovery/candidates/[id]/[decision].js';
import installationActionHandler from '../api/admin/recovery/installations/[id]/[decision].js';

describe('Vercel admin action entrypoints', () => {
  it('forwards nested recovery actions to the authenticated Hono handler', () => {
    expect(candidateActionHandler).toBe(handler);
    expect(installationActionHandler).toBe(handler);
  });
});
