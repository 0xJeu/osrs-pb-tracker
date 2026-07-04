import { Hono } from 'hono';
import { cors } from 'hono/cors';

export const app = new Hono();

app.use('*', cors());

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
