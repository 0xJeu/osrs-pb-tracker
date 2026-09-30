import { describe, expect, it } from 'vitest';
import { getPublicReadModelConfig } from '../src/lib/public-read-model/config.js';

describe('public read-model configuration', () => {
  it('fails closed to disabled for missing or unexpected modes', () => {
    expect(getPublicReadModelConfig({} as NodeJS.ProcessEnv).mode).toBe('disabled');
    expect(getPublicReadModelConfig({ PUBLIC_READ_MODEL_MODE: 'surprise' } as NodeJS.ProcessEnv).mode)
      .toBe('disabled');
  });

  it('prefers Upstash names and supports Vercel KV aliases', () => {
    expect(getPublicReadModelConfig({
      PUBLIC_READ_MODEL_MODE: 'primary',
      UPSTASH_REDIS_REST_URL: 'https://upstash',
      UPSTASH_REDIS_REST_TOKEN: 'upstash-token',
      KV_REST_API_URL: 'https://kv',
      KV_REST_API_TOKEN: 'kv-token',
    } as NodeJS.ProcessEnv)).toMatchObject({
      mode: 'primary',
      redisUrl: 'https://upstash',
      redisToken: 'upstash-token',
    });

    expect(getPublicReadModelConfig({
      PUBLIC_READ_MODEL_MODE: 'shadow',
      KV_REST_API_URL: 'https://kv',
      KV_REST_API_TOKEN: 'kv-token',
    } as NodeJS.ProcessEnv)).toMatchObject({
      mode: 'shadow',
      redisUrl: 'https://kv',
      redisToken: 'kv-token',
    });
  });
});
