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
  colo: { base: 'fortis colosseum', target: 'fortis colosseum' },
  sol: { base: 'fortis colosseum', target: 'fortis colosseum' },
  jad: { base: 'tzhaar fight cave', target: 'tzhaar fight cave' },
  zuk: { base: 'inferno', target: 'inferno' },
  corp: { base: 'corporeal beast', target: 'corporeal beast' },
  kq: { base: 'kalphite queen', target: 'kalphite queen' },
  kbd: { base: 'king black dragon', target: 'king black dragon' },
  sara: { base: 'commander zilyana', target: 'commander zilyana' },
  zilyana: { base: 'commander zilyana', target: 'commander zilyana' },
  bandos: { base: 'general graardor', target: 'general graardor' },
  graardor: { base: 'general graardor', target: 'general graardor' },
  zammy: { base: "k'ril tsutsaroth", target: "k'ril tsutsaroth" },
  kril: { base: "k'ril tsutsaroth", target: "k'ril tsutsaroth" },
  arma: { base: "kree'arra", target: "kree'arra" },
  kree: { base: "kree'arra", target: "kree'arra" },
  vork: { base: 'vorkath', target: 'vorkath' },
  hydra: { base: 'alchemical hydra', target: 'alchemical hydra' },
  muspah: { base: 'phantom muspah', target: 'phantom muspah' },
  tnm: { base: 'nightmare', target: 'nightmare' },
  pnm: { base: "phosani's nightmare", target: "phosani's nightmare" },
  phosani: { base: "phosani's nightmare", target: "phosani's nightmare" },
  duke: { base: 'duke sucellus', target: 'duke sucellus' },
  levi: { base: 'leviathan', target: 'leviathan' },
  whisp: { base: 'whisperer', target: 'whisperer' },
  vard: { base: 'vardorvis', target: 'vardorvis' },
  cerb: { base: 'cerberus', target: 'cerberus' },
  sire: { base: 'abyssal sire', target: 'abyssal sire' },
  thermy: { base: 'thermonuclear smoke devil', target: 'thermonuclear smoke devil' },
  gg: { base: 'grotesque guardians', target: 'grotesque guardians' },
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
