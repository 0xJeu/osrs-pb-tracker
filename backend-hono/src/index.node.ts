import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';

// Serves the existing static website during local dev, matching what the
// Express backend does today. This goes away once the Vite frontend
// sub-project replaces the static site - not carried over to the Vercel
// deployment in Task 13.
app.use('/*', serveStatic({ root: '../website' }));

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PB tracker backend (Hono) listening on http://localhost:${info.port}`);
});
