import { titleCase } from './format';

export type Category = 'Raids' | 'Slayer Monsters' | 'Minigames & Challenges' | 'Bosses' | 'Other';

const CATEGORY_ORDER: Category[] = ['Raids', 'Bosses', 'Slayer Monsters', 'Minigames & Challenges', 'Other'];

const RAID_PREFIXES = ['chambers of xeric', 'theatre of blood', 'tombs of amascut'];

// Non-raid bosses that still get synced with multiple team-size variants
// (The Nightmare scales 1-6+ players) and so benefit from the same
// "collapse to one row, then pick a variant" treatment as raids, even though
// they stay in their normal category (Bosses) rather than becoming a Raid.
const GROUPED_BOSS_PREFIXES = [...RAID_PREFIXES, 'the nightmare'];

// The wiki's "Slayer bosses" set (Kraken, Cerberus, Abyssal Sire,
// Thermonuclear Smoke Devil, Alchemical Hydra, Grotesque Guardians, Araxxor,
// Shellbane Gryphon) are gated behind an active matching Slayer task. Skotizo
// and Kalphite Queen aren't task-gated but are commonly killed as Slayer
// task substitutes, so they're grouped here too per the handoff spec.
const SLAYER_MONSTERS = [
  'kraken',
  'cerberus',
  'thermonuclear smoke devil',
  'alchemical hydra',
  'abyssal sire',
  'grotesque guardians',
  'araxxor',
  'shellbane gryphon',
  'skotizo',
  'kalphite queen',
];

const MINIGAMES = [
  'tempoross',
  'wintertodt',
  'barbarian assault',
  'guardians of the rift',
  'gauntlet',
  'corrupted gauntlet',
  'inferno',
  'tzhaar fight cave',
  'fortis colosseum',
  'hallowed sepulchre',
  'shayzien basic agility course',
  "tzhaar-ket-rak's first challenge",
  "tzhaar-ket-rak's second challenge",
  "tzhaar-ket-rak's third challenge",
  "tzhaar-ket-rak's fourth challenge",
];

// Curated so common OSRS bosses land in "Bosses" instead of the "Other"
// catch-all; anything not recognized here still shows up under "Other"
// rather than disappearing. Entries are stored already normalized (no
// leading "the "), since matchesCurated() compares against normalized keys.
const KNOWN_BOSSES = [
  'nex',
  'zulrah',
  'vorkath',
  'sarachnis',
  'vardorvis',
  'duke sucellus',
  'leviathan',
  'whisperer',
  'general graardor',
  "kree'arra",
  'commander zilyana',
  "k'ril tsutsaroth",
  'callisto',
  'artio',
  'venenatis',
  'spindel',
  "vet'ion",
  "calvar'ion",
  'chaos elemental',
  'chaos fanatic',
  'crazy archaeologist',
  'deranged archaeologist',
  'king black dragon',
  'giant mole',
  'zalcano',
  'obor',
  'bryophyta',
  'dagannoth rex',
  'dagannoth prime',
  'dagannoth supreme',
  'corporeal beast',
  'nightmare',
  "phosani's nightmare",
  'scorpia',
  'tztok-jad',
  'amoxliatl',
  'brutus',
  'fragment of seren',
  'galvek',
  'hespori',
  'maggot king',
  'mimic',
  'phantom muspah',
  'royal titans',
  'scurrius',
  'shellbane gryphon',
  'hueycoatl',
  'yama',
];

// Entry < Normal < Hard/Challenge Mode/Expert, matching each raid's real
// in-game difficulty progression (the "hardest tier" name differs per raid -
// Hard for ToB, Challenge Mode for CoX, Expert for ToA - so they all share
// the same rank; no raid has more than one of them at once).
const MODE_PRIORITY: Record<string, number> = {
  entry: 1,
  '': 2,
  hard: 3,
  'challenge mode': 3,
  expert: 3,
};

function normalize(key: string): string {
  return key.trim().toLowerCase().replace(/^the /, '');
}

function matchesCurated(key: string, curated: string[]): boolean {
  const n = normalize(key);
  return curated.some((name) => n === name || n.startsWith(`${name} (`) || n.startsWith(`${name} -`));
}

function isRaid(key: string): boolean {
  const lower = key.trim().toLowerCase();
  // A few synced keys arrive as one run-on phrase instead of using " - " to
  // separate the raid name from a mode suffix (e.g. "theatre of blood entry
  // mode", "tombs of amascut expert mode" - seen from an older/alternate sync
  // path). Matching on a plain trailing space, not just " -", still
  // recognizes these as belonging to the raid rather than falling through to
  // "Other" - see categorize() below.
  return RAID_PREFIXES.some((p) => lower === p || lower.startsWith(`${p} -`) || lower.startsWith(`${p} `));
}

// Whether a key belongs to a multi-variant boss (raid or otherwise) that
// should be collapsed into one row + drill-down, rather than shown as its
// own flat entry per variant. Independent of categorize() - a grouped boss
// keeps its normal category (e.g. The Nightmare stays under "Bosses").
export function isGroupedVariant(key: string): boolean {
  const lower = key.trim().toLowerCase();
  return GROUPED_BOSS_PREFIXES.some((p) => lower === p || lower.startsWith(`${p} -`));
}

export function categorize(bossKey: string): Category {
  if (isRaid(bossKey)) return 'Raids';
  if (matchesCurated(bossKey, SLAYER_MONSTERS)) return 'Slayer Monsters';
  if (matchesCurated(bossKey, MINIGAMES)) return 'Minigames & Challenges';
  if (matchesCurated(bossKey, KNOWN_BOSSES)) return 'Bosses';
  // Same run-on-phrase issue as isRaid() above, but for The Nightmare's
  // bare/no-"the" sync format (e.g. "nightmare 6+ players" instead of "the
  // nightmare - fastest overall (6+ players)"). matchesCurated() can't catch
  // this via the generic curated-list check without risking false matches
  // for other curated names, so it's handled with its own narrow check here.
  if (normalize(bossKey).startsWith('nightmare ')) return 'Bosses';
  return 'Other';
}

interface RaidVariant {
  key: string;
  base: string;
  mode: string;
  heading: string;
  subLabel: string;
}

function parseRaidVariant(bossKey: string): RaidVariant {
  const segments = bossKey.trim().toLowerCase().split(' - ').map((s) => s.trim());
  const base = segments[0];
  const mode = segments.slice(1, -1).join(' - ');
  const heading = mode ? `${titleCase(base)} - ${titleCase(mode)}` : titleCase(base);
  const isBareOverall = segments.length === 1;
  const subLabel = isBareOverall ? 'Overall' : titleCase(segments[segments.length - 1]);
  return { key: bossKey, base, mode, heading, subLabel };
}

function teamSizeRank(subLabel: string): number {
  const lower = subLabel.toLowerCase();
  if (lower.includes('solo')) return 1;
  const match = lower.match(/(\d+)/);
  return match ? Number(match[1]) : 999;
}

function variantRank(subLabel: string): number {
  return subLabel.toLowerCase().startsWith('fastest overall') ? 0 : 1;
}

// Community team-size nicknames, e.g. "Fastest Overall (3 Player)" -> "Trio".
// Anything above Trio just gets "N-Man", which is how OSRS players refer to it.
const SIZE_NICKNAMES: Record<number, string> = { 1: 'Solo', 2: 'Duo', 3: 'Trio' };

// Pulls the player-count portion out of a variant label, e.g.
// "Fastest Overall (4 Player Hard Mode)" -> "4-Man", or a capped/mass size
// like "Fastest Overall (6+ Players)" -> "6+". Returns null for labels with
// no team size at all (e.g. the legacy "(Former)" entries), so callers can
// fall back to showing the full label instead of a made-up size.
function sizeLabel(label: string): string | null {
  const lower = label.toLowerCase();
  if (/\bsolo\b/.test(lower)) return 'Solo';
  const match = lower.match(/(\d+)(\+)?\s*players?/);
  if (!match) return null;
  const n = Number(match[1]);
  if (match[2]) return `${n}+`;
  return SIZE_NICKNAMES[n] ?? `${n}-Man`;
}

export type VariantKind = 'Overall' | 'Room' | 'Other' | 'Legacy';

function variantKind(label: string): VariantKind {
  const lower = label.toLowerCase();
  // Pre-team-size-split stats (frozen at whatever a player's best was when
  // Jagex introduced per-size tracking) aren't a real team size and don't
  // belong mixed into Room/Overall - keep them together and clearly set apart
  // instead of splitting them across Room/Other by whatever word comes first.
  if (lower.includes('(former)')) return 'Legacy';
  if (lower === 'overall') return 'Overall';
  if (lower.startsWith('fastest overall')) return 'Overall';
  if (lower.startsWith('fastest room')) return 'Room';
  return 'Other';
}

export interface VariantKindGroup {
  kind: VariantKind;
  variants: { key: string; label: string; sizeLabel: string }[];
}

// Splits a mode's flat variant list (Fastest Overall/Room x team size, plus
// any oddballs like the legacy "(Former)" entries) into Overall/Room/Other/
// Legacy buckets, each sorted and re-labeled by team size (Solo/Duo/Trio/
// 4-Man/...) so the UI can offer "pick a type, then a size" instead of one
// long list.
export function groupVariantsByKind(variants: { key: string; label: string }[]): VariantKindGroup[] {
  const byKind = new Map<VariantKind, { key: string; label: string }[]>();
  for (const v of variants) {
    const kind = variantKind(v.label);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(v);
  }

  const kindOrder: VariantKind[] = ['Overall', 'Room', 'Other', 'Legacy'];
  return kindOrder
    .filter((kind) => byKind.has(kind))
    .map((kind) => ({
      kind,
      variants: byKind
        .get(kind)!
        .sort((a, b) => teamSizeRank(a.label) - teamSizeRank(b.label))
        .map((v) => ({ key: v.key, label: v.label, sizeLabel: sizeLabel(v.label) ?? v.label })),
    }));
}

export interface RaidGroup {
  heading: string;
  variants: { key: string; label: string }[];
}

export interface CategoryGroup {
  category: Category;
  raidGroups?: RaidGroup[];
  items?: { key: string; label: string }[];
}

export function groupBosses(bosses: string[]): CategoryGroup[] {
  const byCategory = new Map<Category, string[]>();
  for (const boss of bosses) {
    const category = categorize(boss);
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push(boss);
  }

  return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => {
    const keys = byCategory.get(category)!;
    const groupedKeys = keys.filter((key) => isGroupedVariant(key));
    const flatKeys = keys.filter((key) => !isGroupedVariant(key));

    const items = flatKeys.length
      ? flatKeys.map((key) => ({ key, label: titleCase(key) })).sort((a, b) => a.label.localeCompare(b.label))
      : undefined;

    if (!groupedKeys.length) {
      return { category, items };
    }

    const variantsByHeading = new Map<string, RaidVariant[]>();
    for (const key of groupedKeys) {
      const variant = parseRaidVariant(key);
      if (!variantsByHeading.has(variant.heading)) variantsByHeading.set(variant.heading, []);
      variantsByHeading.get(variant.heading)!.push(variant);
    }

    const raidGroups = Array.from(variantsByHeading.values())
      .map((variants) => {
        const sorted = variants.sort(
          (a, b) => teamSizeRank(a.subLabel) - teamSizeRank(b.subLabel) || variantRank(a.subLabel) - variantRank(b.subLabel)
        );
        return {
          heading: variants[0].heading,
          base: variants[0].base,
          mode: variants[0].mode,
          variants: sorted.map((v) => ({ key: v.key, label: v.subLabel })),
        };
      })
      .sort((a, b) => a.base.localeCompare(b.base) || (MODE_PRIORITY[a.mode] ?? (a.mode ? 50 : 0)) - (MODE_PRIORITY[b.mode] ?? (b.mode ? 50 : 0)))
      .map(({ heading, variants }) => ({ heading, variants }));

    return { category, raidGroups, items };
  });
}

export interface RaidBase {
  base: string;
  label: string;
}

// Collapses a list of grouped headings (which may include several modes for
// the same base, e.g. "Chambers Of Xeric" + "Chambers Of Xeric - Challenge
// Mode") down to one row per base.
export function basesFromGroups(groups: RaidGroup[]): RaidBase[] {
  const seen = new Map<string, RaidBase>();
  for (const group of groups) {
    const label = group.heading.split(' - ')[0];
    const base = label.toLowerCase();
    if (!seen.has(base)) seen.set(base, { base, label });
  }
  return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
}

// One row per grouped boss (raid or otherwise, ignoring mode) - used by
// comboboxes that collapse a multi-variant boss's dozen+ variants down to a
// single entry point. Searches every category, since a grouped boss like The
// Nightmare stays under "Bosses" rather than "Raids".
export function getRaidBases(bosses: string[]): RaidBase[] {
  const allGroups = groupBosses(bosses).flatMap((g) => g.raidGroups ?? []);
  return basesFromGroups(allGroups);
}

export interface RaidMode {
  modeLabel: string;
  variants: { key: string; label: string }[];
}

// All modes (Entry, Normal, Hard/Challenge Mode/Expert) for a single grouped
// boss base, each with its own list of room/overall/team-size variants.
// "Normal" matches the in-game difficulty label (as opposed to Hard
// Mode/Challenge Mode/Expert Mode), rather than an internal placeholder like
// "Regular". Bosses with no mode split (e.g. The Nightmare) just get one
// "Normal" entry.
export function getRaidModes(bosses: string[], base: string): RaidMode[] {
  const allGroups = groupBosses(bosses).flatMap((g) => g.raidGroups ?? []);
  const baseLabel = titleCase(base);
  return allGroups
    .filter((g) => g.heading === baseLabel || g.heading.startsWith(`${baseLabel} - `))
    .map((g) => ({
      modeLabel: g.heading === baseLabel ? 'Normal' : g.heading.slice(baseLabel.length + 3),
      variants: g.variants,
    }));
}
