import { Hono } from 'hono';
import { db } from '../db/client.js';
import { feedback } from '../db/schema.js';
import { isRateLimited } from '../lib/secret.js';

const feedbackRoute = new Hono();

const MAX_MESSAGE_LENGTH = 2000;
const MAX_CONTEXT_LENGTH = 200;

interface FeedbackBody {
  message?: unknown;
  context?: unknown;
}

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  // No account identity is attached to feedback (it's meant to be low-friction
  // and anonymous), so rate limiting falls back to the caller's IP instead of
  // the accountHash key sync.ts uses.
  const forwardedFor = c.req.header('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || 'unknown';
}

feedbackRoute.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as FeedbackBody | null;
  const rawMessage = body?.message;

  if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
    return c.json({ error: 'message is required' }, 400);
  }

  const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);

  let context: string | null = null;
  if (typeof body?.context === 'string' && body.context.trim().length > 0) {
    context = body.context.trim().slice(0, MAX_CONTEXT_LENGTH);
  }

  if (isRateLimited(`feedback:${clientKey(c)}`)) {
    return c.json({ error: 'Too many feedback submissions, slow down.' }, 429);
  }

  await db.insert(feedback).values({ message, context, createdAt: new Date() });

  return c.json({ ok: true });
});

export default feedbackRoute;
