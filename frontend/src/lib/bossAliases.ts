interface BossSearchAlias {
  base: string;
  modeLabel?: string;
  target: string;
}

const BOSS_SEARCH_ALIASES: Record<string, BossSearchAlias> = {
  toa: { base: 'tombs of amascut', target: 'tombs of amascut' },
  tob: { base: 'theatre of blood', target: 'theatre of blood' },
  cox: { base: 'chambers of xeric', target: 'chambers of xeric' },
  cm: { base: 'chambers of xeric', modeLabel: 'Challenge Mode', target: 'chambers of xeric - challenge mode' },
  'cox cm': { base: 'chambers of xeric', modeLabel: 'Challenge Mode', target: 'chambers of xeric - challenge mode' },
  hmt: { base: 'theatre of blood', modeLabel: 'Hard', target: 'theatre of blood - hard' },
  'tob hm': { base: 'theatre of blood', modeLabel: 'Hard', target: 'theatre of blood - hard' },
};

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function bossSearchAlias(query: string): BossSearchAlias | undefined {
  return BOSS_SEARCH_ALIASES[normalizeAlias(query)];
}

export function bossSearchAliasTarget(query: string): string | undefined {
  return bossSearchAlias(query)?.target;
}

export function matchesBossSearch(boss: string, query: string): boolean {
  const normalizedBoss = boss.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  const aliasTarget = bossSearchAliasTarget(query);
  return normalizedBoss.includes(normalizedQuery) || Boolean(aliasTarget && normalizedBoss.includes(aliasTarget));
}
