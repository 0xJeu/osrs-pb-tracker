export type DatabaseTarget = 'primary' | 'standby';

type DatabaseEnvironment = {
  DATABASE_TARGET?: string;
  DATABASE_URL?: string;
  DATABASE_URL_PRIMARY?: string;
  DATABASE_URL_STANDBY?: string;
  VERCEL_ENV?: string;
};

export function resolveDatabaseUrl(
  env: DatabaseEnvironment = process.env
): string {
  const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase();

  if (vercelEnvironment && vercelEnvironment !== 'production') {
    if (!env.DATABASE_URL) {
      throw new Error(
        'Vercel Preview and Development environments require DATABASE_URL'
      );
    }
    return env.DATABASE_URL;
  }

  const target = (env.DATABASE_TARGET ?? 'primary').trim().toLowerCase();

  if (target === 'primary') {
    const primaryUrl = env.DATABASE_URL_PRIMARY ?? env.DATABASE_URL;
    if (!primaryUrl) {
      throw new Error(
        'Primary database target requires DATABASE_URL_PRIMARY or DATABASE_URL'
      );
    }
    return primaryUrl;
  }

  if (target === 'standby') {
    if (!env.DATABASE_URL_STANDBY) {
      throw new Error(
        'Standby database target requires DATABASE_URL_STANDBY'
      );
    }
    return env.DATABASE_URL_STANDBY;
  }

  throw new Error(
    'DATABASE_TARGET must be either "primary" or "standby"'
  );
}
