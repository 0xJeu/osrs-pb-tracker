import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bossesRoute from './routes/bosses';
import leaderboardRoute from './routes/leaderboard';
import playersRoute from './routes/players';
import searchRoute from './routes/search';
import syncRoute from './routes/sync';

export const app = new Hono();

app.use('*', cors());

app.route('/api/bosses', bossesRoute);
app.route('/api/leaderboard', leaderboardRoute);
app.route('/api/players', playersRoute);
app.route('/api/search', searchRoute);
app.route('/api/sync', syncRoute);

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
