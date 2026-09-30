import { serve } from '@hono/node-server';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 8787);
const app = createApp(openDb());

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Mello API listening on http://localhost:${info.port}`);
  if (!process.env.NEBIUS_API_KEY) console.warn('NEBIUS_API_KEY not set: challenges and the agent will return 503.');
});
