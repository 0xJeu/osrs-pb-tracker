import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { resolveDatabaseUrl } from './src/db/connection';

config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
});
