import { config } from 'dotenv';

config();

const { publishPublicSnapshot } = await import('../src/lib/public-read-model/service.js');
const result = await publishPublicSnapshot();
console.log(JSON.stringify({ result }));
if (result !== 'published' && result !== 'stale-rejected') process.exitCode = 1;
