import { config } from 'dotenv';
import { assertDatabaseTarget } from '../src/db/targetGuard.js';

config({ path: '.env.test' });

await assertDatabaseTarget('destructive-test');
