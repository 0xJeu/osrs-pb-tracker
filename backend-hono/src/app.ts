import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bossesRoute from './routes/bosses';

export const app = new Hono();

app.use('*', cors());

app.route('/api/bosses', bossesRoute);

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
