import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bossesRoute from './routes/bosses.js';
import feedbackRoute from './routes/feedback.js';
import leaderboardRoute from './routes/leaderboard.js';
import playersRoute from './routes/players.js';
import recentSyncsRoute from './routes/recent-syncs.js';
import searchRoute from './routes/search.js';
import syncRoute from './routes/sync.js';

export const app = new Hono();

app.use('*', cors());

app.route('/api/bosses', bossesRoute);
app.route('/api/feedback', feedbackRoute);
app.route('/api/leaderboard', leaderboardRoute);
app.route('/api/players', playersRoute);
app.route('/api/recent-syncs', recentSyncsRoute);
app.route('/api/search', searchRoute);
app.route('/api/sync', syncRoute);

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
