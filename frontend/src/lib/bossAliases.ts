const BOSS_SEARCH_ALIASES: Record<string, string> = {
  toa: 'tombs of amascut',
  tob: 'theatre of blood',
  cox: 'chambers of xeric',
  cm: 'chambers of xeric challenge mode',
  'cox cm': 'chambers of xeric challenge mode',
  hmt: 'theatre of blood hard mode',
  'tob hm': 'theatre of blood hard mode',
};

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function bossSearchAliasTarget(query: string): string | undefined {
  return BOSS_SEARCH_ALIASES[normalizeAlias(query)];
}

export function matchesBossSearch(boss: string, query: string): boolean {
  const normalizedBoss = boss.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const aliasTarget = bossSearchAliasTarget(query);
  return normalizedBoss.includes(normalizedQuery) || Boolean(aliasTarget && normalizedBoss.includes(aliasTarget));
}
