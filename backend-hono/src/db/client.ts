import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.js';
import { resolveDatabaseUrl } from './connection.js';

const connectionString = resolveDatabaseUrl();
const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
