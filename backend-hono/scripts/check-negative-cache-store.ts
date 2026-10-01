// Explicit provider validation; requires selected test credentials and writes
// only UUID-isolated scratch keys, never snapshot/player keys. Synthetic only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Redis } from '@upstash/redis';
import { negativeCacheScripts } from '../src/lib/negativeCache.js';

const url = process.env.NEGATIVE_CACHE_TEST_REDIS_URL;
const token = process.env.NEGATIVE_CACHE_TEST_REDIS_TOKEN;
if (!url || !token) throw new Error('Explicit isolated-key Redis test configuration required');
const first = new Redis({ url, token, automaticDeserialization: false, retry: { retries: 0 }, signal: () => AbortSignal.timeout(5000) });
const second = new Redis({ url, token, automaticDeserialization: false, retry: { retries: 0 }, signal: () => AbortSignal.timeout(5000) });
const prefix = `negative-cache-test:${randomUUID()}`;
const control = `${prefix}:generation`, index = `${prefix}:entries`;
const recordKeys = [1,2,3].map(n => `${prefix}:record:${n}`);
const tests: string[] = [];
try {
  const generation = await first.eval<string[], string>(negativeCacheScripts.generation,[control],['generation-one']);
  assert.equal(generation,'generation-one');
  assert.equal(await second.eval(negativeCacheScripts.generation,[control],['generation-two']),'generation-one');
  tests.push('two-client generation initialization');
  const now=Date.now();
  const envelope=JSON.stringify({version:1,generation,expiresAt:now+300000,value:true});
  const publish=(client:Redis,n:number,g=String(generation)) => client.eval(negativeCacheScripts.publish,
    [control,recordKeys[n]!,index],[g,envelope,now,300,2]);
  assert.equal(await publish(first,0),1);
  assert.equal(await second.eval(negativeCacheScripts.read,[control,recordKeys[0]!],[]),envelope);
  tests.push('cross-client publish and read');
  assert.equal(await publish(second,1),1);
  assert.equal(await publish(first,2),0);
  tests.push('bounded cardinality');
  await second.set(control,'generation-next');
  assert.equal(await first.eval(negativeCacheScripts.read,[control,recordKeys[0]!],[]),null);
  assert.equal(await publish(first,0),0);
  tests.push('invalidation and delayed-fill rejection');
  for (const corrupt of ['not-json',42,true,null]) {
    await first.set(recordKeys[0]!,corrupt);
    assert.equal(await second.eval(negativeCacheScripts.read,[control,recordKeys[0]!],[]),null);
  }
  tests.push('corrupt record fallback');
  await first.del(control);
  assert.equal(await second.eval(negativeCacheScripts.read,[control,recordKeys[1]!],[]),null);
  tests.push('missing-control fallback');
  console.log(JSON.stringify({passed:tests.length,tests}));
} finally {
  await first.del(control,index,...recordKeys);
}
