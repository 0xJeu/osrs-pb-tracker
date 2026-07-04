import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';

// Serve the existing static website during local dev, matching Express.
app.use('/*', serveStatic({ root: '../website' }));

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PB tracker backend (Hono) listening on http://localhost:${info.port}`);
});
