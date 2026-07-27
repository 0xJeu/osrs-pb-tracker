export type DatabaseTarget = 'primary' | 'standby';

type DatabaseEnvironment = {
  DATABASE_TARGET?: string;
  DATABASE_URL?: string;
  DATABASE_URL_PRIMARY?: string;
  DATABASE_URL_STANDBY?: string;
};

export function resolveDatabaseUrl(
  env: DatabaseEnvironment = process.env
): string {
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
