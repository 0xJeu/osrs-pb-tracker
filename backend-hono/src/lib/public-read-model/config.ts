export type PublicReadModelMode = 'disabled' | 'shadow' | 'primary';

export interface PublicReadModelConfig {
  mode: PublicReadModelMode;
  namespace: string;
  redisUrl: string | null;
  redisToken: string | null;
  timeoutMs: number;
}

export function getPublicReadModelConfig(env: NodeJS.ProcessEnv = process.env): PublicReadModelConfig {
  const rawMode = env.PUBLIC_READ_MODEL_MODE?.trim().toLowerCase() ?? 'disabled';
  const mode: PublicReadModelMode = rawMode === 'primary' || rawMode === 'shadow'
    ? rawMode
    : 'disabled';
  const timeout = Number(env.PUBLIC_READ_MODEL_REDIS_TIMEOUT_MS ?? 250);
  const redisUrl = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL ?? null;
  const redisToken = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN ?? null;
  return {
    mode,
    namespace: env.PUBLIC_READ_MODEL_NAMESPACE?.trim() || 'pbt:prod:v1',
    redisUrl,
    redisToken,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 250,
  };
}
