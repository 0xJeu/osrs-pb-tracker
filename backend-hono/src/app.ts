import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bossesRoute from './routes/bosses';
import searchRoute from './routes/search';

export const app = new Hono();

app.use('*', cors());

app.route('/api/bosses', bossesRoute);
app.route('/api/search', searchRoute);

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
