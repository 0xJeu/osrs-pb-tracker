import { describe, expect, it } from 'vitest';
import {
  categorize,
  getRaidBases,
  getRaidModes,
  groupBosses,
  groupedBaseForKey,
  groupPlayerRaidPbs,
  groupVariantsByKind,
  isGroupedVariant,
} from '../src/lib/bossGroups';

const DOOM_KEYS_SHUFFLED = [
  'doom of mokhaiotl - delve 8+',
  'doom of mokhaiotl - delve 3',
  'doom of mokhaiotl - delve 1',
  'doom of mokhaiotl - delve 7',
  'doom of mokhaiotl - delve 5',
  'doom of mokhaiotl - delve 8',
  'doom of mokhaiotl - delve 2',
  'doom of mokhaiotl - delve 6',
  'doom of mokhaiotl - delve 4',
];
const DOOM_LABELS_IN_ORDER = ['Delve 1', 'Delve 2', 'Delve 3', 'Delve 4', 'Delve 5', 'Delve 6', 'Delve 7', 'Delve 8', 'Delve 8+'];

describe('Doom of Mokhaiotl delves', () => {
  it('collapses every delve tier into one Bosses entry, ordered Delve 1-8 then 8+', () => {
    const bosses = groupBosses([...DOOM_KEYS_SHUFFLED, 'zulrah']).find((g) => g.category === 'Bosses');
    expect(bosses?.raidGroups?.map((r) => r.heading)).toEqual(['Doom Of Mokhaiotl']);
    expect(bosses?.raidGroups?.[0].variants.map((v) => v.label)).toEqual(DOOM_LABELS_IN_ORDER);
    expect(bosses?.raidGroups?.[0].variants.map((v) => v.key)).toEqual([
      'doom of mokhaiotl - delve 1',
      'doom of mokhaiotl - delve 2',
      'doom of mokhaiotl - delve 3',
      'doom of mokhaiotl - delve 4',
      'doom of mokhaiotl - delve 5',
      'doom of mokhaiotl - delve 6',
      'doom of mokhaiotl - delve 7',
      'doom of mokhaiotl - delve 8',
      'doom of mokhaiotl - delve 8+',
    ]);
    expect(bosses?.items?.map((i) => i.key)).toEqual(['zulrah']);
  });

  it('keeps the stored key casing the plugin sent', () => {
    const variants = groupBosses(['Doom of Mokhaiotl - Delve 8+', 'Doom of Mokhaiotl - Delve 2'])[0].raidGroups?.[0].variants;
    expect(variants).toEqual([
      { key: 'Doom of Mokhaiotl - Delve 2', label: 'Delve 2' },
      { key: 'Doom of Mokhaiotl - Delve 8+', label: 'Delve 8+' },
    ]);
  });

  it('groups only the tracked delve tiers, leaving unsupported Doom keys as flat items', () => {
    expect(isGroupedVariant('doom of mokhaiotl - delve 1')).toBe(true);
    expect(isGroupedVariant('Doom of Mokhaiotl - Delve 8+')).toBe(true);
    expect(isGroupedVariant('doom of mokhaiotl')).toBe(false);
    expect(isGroupedVariant('doom of mokhaiotl - delve 9')).toBe(false);
    expect(isGroupedVariant('doom of mokhaiotl deepest delve')).toBe(false);
  });

  it('exposes one Doom base and a single-mode picker, like The Nightmare', () => {
    expect(getRaidBases(DOOM_KEYS_SHUFFLED)).toEqual([{ base: 'doom of mokhaiotl', label: 'Doom Of Mokhaiotl' }]);
    expect(groupedBaseForKey('doom of mokhaiotl - delve 8+')).toBe('doom of mokhaiotl');

    const modes = getRaidModes(DOOM_KEYS_SHUFFLED, 'doom of mokhaiotl');
    expect(modes.map((m) => m.modeLabel)).toEqual(['Normal']);
    const kinds = groupVariantsByKind(modes[0].variants);
    expect(kinds.map((k) => k.kind)).toEqual(['Other']);
    expect(kinds[0].variants.map((v) => v.sizeLabel)).toEqual(DOOM_LABELS_IN_ORDER);
  });

  it('groups a player profile\'s delve PBs under one heading in delve order', () => {
    const pbs = DOOM_KEYS_SHUFFLED.map((boss, i) => ({ boss, timeSeconds: 60 + i, updatedAt: '2026-09-22T00:00:00Z', rank: i + 1 }));
    const { groups, flat } = groupPlayerRaidPbs([...pbs, { boss: 'zulrah', timeSeconds: 50, updatedAt: '2026-09-22T00:00:00Z', rank: 1 }]);
    expect(flat.map((pb) => pb.boss)).toEqual(['zulrah']);
    expect(groups.map((g) => g.heading)).toEqual(['Doom Of Mokhaiotl']);
    expect(groups[0].variants.map((v) => v.label)).toEqual(DOOM_LABELS_IN_ORDER);
  });

  it('handles only some tiers existing (Delve 1-4 synced, nothing for 5-8 or 8+)', () => {
    const keys = ['doom of mokhaiotl - delve 4', 'doom of mokhaiotl - delve 2', 'doom of mokhaiotl - delve 1', 'doom of mokhaiotl - delve 3'];
    const modes = getRaidModes(keys, 'doom of mokhaiotl');
    expect(modes).toHaveLength(1);
    expect(modes[0].variants.map((v) => v.label)).toEqual(['Delve 1', 'Delve 2', 'Delve 3', 'Delve 4']);

    const pbs = [
      { boss: 'doom of mokhaiotl - delve 1', timeSeconds: 49, updatedAt: '2026-09-23T00:00:00Z', rank: 1 },
      { boss: 'doom of mokhaiotl - delve 2', timeSeconds: 55, updatedAt: '2026-09-23T00:00:00Z', rank: 1 },
      { boss: 'doom of mokhaiotl - delve 3', timeSeconds: 96, updatedAt: '2026-09-23T00:00:00Z', rank: 1 },
      { boss: 'doom of mokhaiotl - delve 4', timeSeconds: 113, updatedAt: '2026-09-23T00:00:00Z', rank: 1 },
    ];
    const [group] = groupPlayerRaidPbs(pbs).groups;
    expect(group.variants.map((v) => v.label)).toEqual(['Delve 1', 'Delve 2', 'Delve 3', 'Delve 4']);
    expect(group.summary).toMatchObject({ key: 'doom of mokhaiotl - delve 4', label: 'Delve 4', timeSeconds: 113 });
  });

  it('summarizes the collapsed row with the deepest delve, counting 8+ as deeper than 8', () => {
    const pb = (tier: string, timeSeconds: number, rank = 1) => ({
      boss: `doom of mokhaiotl - delve ${tier}`, timeSeconds, updatedAt: `2026-09-2${rank}T00:00:00Z`, rank,
    });
    const summaryOf = (pbs: ReturnType<typeof pb>[]) => groupPlayerRaidPbs(pbs).groups[0].summary;

    expect(summaryOf([pb('8+', 30, 7), pb('8', 20, 3), pb('1', 10, 1)]))
      .toEqual({ key: 'doom of mokhaiotl - delve 8+', label: 'Delve 8+', kind: 'Other', timeSeconds: 30, rank: 7, updatedAt: '2026-09-27T00:00:00Z' });
    expect(summaryOf([pb('2', 55), pb('8', 20), pb('7', 10)]).label).toBe('Delve 8');
    expect(summaryOf([pb('3', 96)]).label).toBe('Delve 3');
  });

  it('keeps the fastest-time summary for raids and The Nightmare', () => {
    const pb = (boss: string, timeSeconds: number) => ({ boss, timeSeconds, updatedAt: '2026-09-22T00:00:00Z', rank: 1 });
    const { groups } = groupPlayerRaidPbs([
      pb('the nightmare - fastest overall (solo)', 600),
      pb('the nightmare - fastest overall (6+ players)', 190),
      pb('chambers of xeric - fastest overall (solo)', 1100),
      pb('chambers of xeric - fastest overall (24+ players)', 1500),
    ]);
    expect(groups.find((g) => g.heading === 'The Nightmare')?.summary.label).toBe('6+');
    expect(groups.find((g) => g.heading === 'Chambers Of Xeric')?.summary.label).toBe('Solo');
  });

  it('produces no Doom entry, and no errors, when no Doom records exist yet', () => {
    const keys = ['zulrah', 'the nightmare - fastest overall (solo)'];
    expect(groupBosses(keys).flatMap((g) => g.raidGroups ?? []).map((r) => r.heading)).toEqual(['The Nightmare']);
    expect(getRaidModes(keys, 'doom of mokhaiotl')).toEqual([]);
    expect(getRaidModes([], 'doom of mokhaiotl')).toEqual([]);
    expect(groupPlayerRaidPbs([])).toEqual({ groups: [], flat: [] });
  });
});

describe('awakened DT2 bosses', () => {
  it('collapses the base and awakened forms into one entry with a Normal/Awakened toggle', () => {
    const keys = ['duke sucellus', 'duke sucellus (awakened)', 'zulrah'];
    const groups = groupBosses(keys);
    const bosses = groups.find((g) => g.category === 'Bosses');

    expect(bosses?.raidGroups?.map((r) => r.heading)).toEqual(['Duke Sucellus']);
    expect(bosses?.raidGroups?.[0].variants).toEqual([
      { key: 'duke sucellus', label: 'Normal' },
      { key: 'duke sucellus (awakened)', label: 'Awakened' },
    ]);
    expect(bosses?.items?.map((i) => i.key)).toEqual(['zulrah']);
  });

  it('is true for isGroupedVariant on both the base and awakened key', () => {
    expect(isGroupedVariant('leviathan')).toBe(true);
    expect(isGroupedVariant('leviathan (awakened)')).toBe(true);
    expect(isGroupedVariant('vardorvis (awakened)')).toBe(true);
    expect(isGroupedVariant('whisperer (awakened)')).toBe(true);
  });

  it('resolves the awakened key back to its base for the raid-base picker', () => {
    expect(groupedBaseForKey('vardorvis (awakened)')).toBe('vardorvis');
    expect(groupedBaseForKey('vardorvis')).toBe('vardorvis');
  });

  it('orders Normal before Awakened even when the awakened key is synced first', () => {
    const modes = getRaidModes(['whisperer (awakened)', 'whisperer'], 'whisperer');
    expect(modes[0].variants.map((v) => v.label)).toEqual(['Normal', 'Awakened']);
  });
});

const ALL_KEYS = [
  'nex',
  'zulrah',
  'vorkath',
  'kraken',
  'cerberus',
  'thermonuclear smoke devil',
  'alchemical hydra',
  'tempoross',
  'wintertodt',
  'inferno',
  'tzhaar fight cave',
  'fortis colosseum',
  'the corrupted gauntlet',
  'chambers of xeric - fastest overall (solo)',
  'chambers of xeric - fastest overall (3 players)',
  'chambers of xeric - challenge mode - fastest overall (3 players)',
  'theatre of blood - fastest room (3 player)',
  'theatre of blood - fastest overall (3 player)',
  'theatre of blood - entry - fastest room (1 player entry mode)',
  'theatre of blood - hard - fastest overall (4 player hard mode)',
  'tombs of amascut - fastest room (2 player)',
  'tombs of amascut - expert - fastest overall (solo)',
  'duke sucellus (awakened)',
  'leviathan (awakened)',
  'whisperer (awakened)',
  'vardorvis (awakened)',
  'the nightmare - fastest overall (solo)',
  'the nightmare - fastest overall (2 players)',
  'the nightmare - fastest overall (6+ players)',
  "phosani's nightmare",
  "tzhaar-ket-rak's first challenge",
  "tzhaar-ket-rak's second challenge",
  "tzhaar-ket-rak's third challenge",
  "tzhaar-ket-rak's fourth challenge",
  "tzhaar-ket-rak's fifth challenge",
  "tzhaar-ket-rak's sixth challenge",
  'doom of mokhaiotl - delve 1',
  'doom of mokhaiotl - delve 8',
  'doom of mokhaiotl - delve 8+',
];

describe('categorize', () => {
  it('buckets raid keys regardless of variant suffix', () => {
    expect(categorize('theatre of blood - hard - fastest overall (4 player hard mode)')).toBe('Raids');
    expect(categorize('chambers of xeric - fastest overall (solo)')).toBe('Raids');
    expect(categorize('tombs of amascut - expert - fastest overall (solo)')).toBe('Raids');
  });

  it('buckets curated slayer monsters', () => {
    expect(categorize('kraken')).toBe('Slayer Monsters');
    expect(categorize('alchemical hydra')).toBe('Slayer Monsters');
  });

  it('buckets task-gated Slayer bosses per the wiki (Araxxor, Shellbane Gryphon)', () => {
    expect(categorize('araxxor')).toBe('Slayer Monsters');
    expect(categorize('shellbane gryphon')).toBe('Slayer Monsters');
  });

  it('keeps non-task-gated bosses (Amoxliatl, The Hueycoatl) out of Slayer Monsters', () => {
    expect(categorize('amoxliatl')).toBe('Bosses');
    expect(categorize('the hueycoatl')).toBe('Bosses');
  });

  it('buckets curated minigames, matching the "the ..." prefix variant', () => {
    expect(categorize('the corrupted gauntlet')).toBe('Minigames & Challenges');
    expect(categorize('inferno')).toBe('Minigames & Challenges');
  });

  it('buckets known standalone bosses, including awakened DT2 variants', () => {
    expect(categorize('zulrah')).toBe('Bosses');
    expect(categorize('duke sucellus (awakened)')).toBe('Bosses');
    expect(categorize('vardorvis (awakened)')).toBe('Bosses');
  });

  it('buckets timed Doom of Mokhaiotl delve records as Bosses', () => {
    expect(categorize('doom of mokhaiotl - delve 1')).toBe('Bosses');
    expect(categorize('doom of mokhaiotl - delve 8')).toBe('Bosses');
    expect(categorize('doom of mokhaiotl - delve 8+')).toBe('Bosses');
    expect(categorize('doom of mokhaiotl')).toBe('Other');
    expect(categorize('doom of mokhaiotl deepest delve')).toBe('Other');
    expect(categorize('doom of mokhaiotl - delve 9')).toBe('Other');
  });

  it('falls back to Other for unrecognized keys instead of dropping them', () => {
    expect(categorize('some brand new boss')).toBe('Other');
  });

  it('buckets run-on-phrase raid/Nightmare keys correctly instead of falling to Other', () => {
    // Real synced keys seen in production without the usual " - " separator
    // (an older/alternate sync path) - these were landing in "Other" before
    // isRaid()/categorize() learned to recognize the plain-space form.
    expect(categorize('theatre of blood entry mode')).toBe('Raids');
    expect(categorize('tombs of amascut expert mode')).toBe('Raids');
    expect(categorize('nightmare 6+ players')).toBe('Bosses');
  });
});

describe('groupBosses', () => {
  it('never drops an entry', () => {
    const groups = groupBosses(ALL_KEYS);
    // A category can have both grouped variants (raidGroups) and flat items
    // at once now (e.g. Bosses has The Nightmare's variants grouped
    // alongside flat entries like Zulrah), so both must be counted.
    const allKeysOut = groups.flatMap((g) => [
      ...(g.raidGroups ?? []).flatMap((r) => r.variants.map((v) => v.key)),
      ...(g.items ?? []).map((i) => i.key),
    ]);
    expect(allKeysOut.sort()).toEqual([...ALL_KEYS].sort());
  });

  it('nests raid variants under a heading per raid + mode', () => {
    const groups = groupBosses(ALL_KEYS);
    const raids = groups.find((g) => g.category === 'Raids');
    expect(raids?.raidGroups?.map((r) => r.heading)).toEqual([
      'Chambers Of Xeric',
      'Chambers Of Xeric - Challenge Mode',
      'Theatre Of Blood - Entry',
      'Theatre Of Blood',
      'Theatre Of Blood - Hard',
      'Tombs Of Amascut',
      'Tombs Of Amascut - Expert',
    ]);

    const tob = raids?.raidGroups?.find((r) => r.heading === 'Theatre Of Blood');
    expect(tob?.variants).toEqual([
      { key: 'theatre of blood - fastest overall (3 player)', label: 'Fastest Overall (3 Player)' },
      { key: 'theatre of blood - fastest room (3 player)', label: 'Fastest Room (3 Player)' },
    ]);
  });

  it('sorts non-raid categories alphabetically by display label', () => {
    const groups = groupBosses(ALL_KEYS);
    const bosses = groups.find((g) => g.category === 'Bosses');
    const labels = bosses?.items?.map((i) => i.label) ?? [];
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps the bare no-team-size key reachable alongside labeled raid variants', () => {
    const keys = [
      'chambers of xeric',
      'chambers of xeric - fastest overall (solo)',
      'chambers of xeric - fastest overall (3 players)',
      'theatre of blood',
      'theatre of blood - fastest overall (3 player)',
    ];
    const groups = groupBosses(keys);
    const raids = groups.find((g) => g.category === 'Raids');

    const cox = raids?.raidGroups?.find((r) => r.heading === 'Chambers Of Xeric');
    expect(cox?.variants.map((v) => v.label)).toEqual(['Fastest Overall (Solo)', 'Fastest Overall (3 Players)', 'Overall']);

    const tob = raids?.raidGroups?.find((r) => r.heading === 'Theatre Of Blood');
    expect(tob?.variants).toEqual([
      { key: 'theatre of blood - fastest overall (3 player)', label: 'Fastest Overall (3 Player)' },
      { key: 'theatre of blood', label: 'Overall' },
    ]);
  });

  it('keeps a bare no-team-size key when it is the only variant for that raid+mode', () => {
    const groups = groupBosses(['chambers of xeric']);
    const raids = groups.find((g) => g.category === 'Raids');
    const cox = raids?.raidGroups?.find((r) => r.heading === 'Chambers Of Xeric');
    expect(cox?.variants).toEqual([{ key: 'chambers of xeric', label: 'Overall' }]);
  });

  it('collapses The Nightmare into a grouped entry under Bosses, alongside flat boss items', () => {
    const keys = [
      'the nightmare - fastest overall (solo)',
      'the nightmare - fastest overall (2 players)',
      "phosani's nightmare",
      'zulrah',
    ];
    const groups = groupBosses(keys);
    const bossesGroup = groups.find((g) => g.category === 'Bosses');

    expect(bossesGroup?.raidGroups?.map((r) => r.heading)).toEqual(['The Nightmare']);
    expect(bossesGroup?.raidGroups?.[0].variants).toEqual([
      { key: 'the nightmare - fastest overall (solo)', label: 'Fastest Overall (Solo)' },
      { key: 'the nightmare - fastest overall (2 players)', label: 'Fastest Overall (2 Players)' },
    ]);
    // Phosani's Nightmare has no team-size split, so it stays a flat item
    // rather than being swept into The Nightmare's group.
    expect(bossesGroup?.items?.map((i) => i.key)).toEqual(["phosani's nightmare", 'zulrah']);
  });

  it('collapses all six TzHaar-Ket-Rak challenges into one numbered picker', () => {
    const keys = [
      "tzhaar-ket-rak's sixth challenge",
      "tzhaar-ket-rak's second challenge",
      "tzhaar-ket-rak's first challenge",
      "tzhaar-ket-rak's fifth challenge",
      "tzhaar-ket-rak's fourth challenge",
      "tzhaar-ket-rak's third challenge",
    ];
    const minigames = groupBosses(keys).find((group) => group.category === 'Minigames & Challenges');
    expect(minigames?.items).toBeUndefined();
    expect(minigames?.raidGroups).toEqual([{
      heading: "TzHaar-Ket-Rak's Challenges",
      variants: [
        { key: "tzhaar-ket-rak's first challenge", label: '1' },
        { key: "tzhaar-ket-rak's second challenge", label: '2' },
        { key: "tzhaar-ket-rak's third challenge", label: '3' },
        { key: "tzhaar-ket-rak's fourth challenge", label: '4' },
        { key: "tzhaar-ket-rak's fifth challenge", label: '5' },
        { key: "tzhaar-ket-rak's sixth challenge", label: '6' },
      ],
    }]);
    expect(getRaidModes(keys, "tzhaar-ket-rak's challenges")[0].variants.map((variant) => variant.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(groupedBaseForKey(keys[0])).toBe("tzhaar-ket-rak's challenges");
  });
});

describe('getRaidModes', () => {
  it('orders modes Entry < Normal < Hard, labeling the no-suffix mode "Normal"', () => {
    const keys = [
      'theatre of blood - fastest overall (3 player)',
      'theatre of blood - entry - fastest overall (1 player entry mode)',
      'theatre of blood - hard - fastest overall (4 player hard mode)',
    ];
    const modes = getRaidModes(keys, 'theatre of blood');
    expect(modes.map((m) => m.modeLabel)).toEqual(['Entry', 'Normal', 'Hard']);
  });

  it('orders modes Entry < Normal < Expert for Tombs of Amascut', () => {
    const keys = [
      'tombs of amascut - fastest overall (solo)',
      'tombs of amascut - entry - fastest overall (solo)',
      'tombs of amascut - expert - fastest overall (solo)',
    ];
    const modes = getRaidModes(keys, 'tombs of amascut');
    expect(modes.map((m) => m.modeLabel)).toEqual(['Entry', 'Normal', 'Expert']);
  });

  it('orders modes Normal < Challenge Mode for Chambers of Xeric', () => {
    const keys = [
      'chambers of xeric - challenge mode - fastest overall (3 players)',
      'chambers of xeric - fastest overall (3 players)',
    ];
    const modes = getRaidModes(keys, 'chambers of xeric');
    expect(modes.map((m) => m.modeLabel)).toEqual(['Normal', 'Challenge Mode']);
  });

  it('finds a single "Normal" mode for The Nightmare, even though it lives under Bosses not Raids', () => {
    const keys = [
      'the nightmare - fastest overall (solo)',
      'the nightmare - fastest overall (2 players)',
      'the nightmare - fastest overall (6+ players)',
    ];
    const modes = getRaidModes(keys, 'the nightmare');
    expect(modes.map((m) => m.modeLabel)).toEqual(['Normal']);
    expect(modes[0].variants.map((v) => v.label)).toEqual([
      'Fastest Overall (Solo)',
      'Fastest Overall (2 Players)',
      'Fastest Overall (6+ Players)',
    ]);
  });
});

describe('getRaidBases', () => {
  it('includes non-raid grouped bosses like The Nightmare alongside raids', () => {
    const keys = [
      'chambers of xeric - fastest overall (solo)',
      'the nightmare - fastest overall (solo)',
      'the nightmare - fastest overall (2 players)',
    ];
    const bases = getRaidBases(keys);
    expect(bases.map((b) => b.label)).toEqual(['Chambers Of Xeric', 'The Nightmare']);
  });
});

describe('isGroupedVariant', () => {
  it('is true for raid keys, The Nightmare, and TzHaar challenges; false for everything else', () => {
    expect(isGroupedVariant('chambers of xeric - fastest overall (solo)')).toBe(true);
    expect(isGroupedVariant('the nightmare - fastest overall (solo)')).toBe(true);
    expect(isGroupedVariant("tzhaar-ket-rak's sixth challenge")).toBe(true);
    expect(isGroupedVariant("phosani's nightmare")).toBe(false);
    expect(isGroupedVariant('zulrah')).toBe(false);
  });

  it('is false for the run-on-phrase raid/Nightmare keys - too ambiguous to place in the mode/size grid', () => {
    // "theatre of blood entry mode" doesn't say whether "entry" is the mode
    // or part of a variant label the way a real 3-segment key would, so
    // rather than guess, these surface as their own flat item within the
    // right category (see categorize() above) instead of being folded into
    // the raid's drill-down.
    expect(isGroupedVariant('theatre of blood entry mode')).toBe(false);
    expect(isGroupedVariant('tombs of amascut expert mode')).toBe(false);
    expect(isGroupedVariant('nightmare 6+ players')).toBe(false);
  });
});

describe('groupBosses with run-on-phrase raid/Nightmare keys', () => {
  it('surfaces them as flat items in the correct category instead of Other', () => {
    const keys = [
      'chambers of xeric - fastest overall (solo)',
      'theatre of blood entry mode',
      'tombs of amascut expert mode',
      'the nightmare - fastest overall (solo)',
      'nightmare 6+ players',
    ];
    const groups = groupBosses(keys);
    expect(groups.find((g) => g.category === 'Other')).toBeUndefined();

    const raids = groups.find((g) => g.category === 'Raids');
    expect(raids?.items?.map((i) => i.label)).toEqual(
      expect.arrayContaining(['Theatre Of Blood Entry Mode', 'Tombs Of Amascut Expert Mode'])
    );

    const bosses = groups.find((g) => g.category === 'Bosses');
    expect(bosses?.items?.map((i) => i.label)).toEqual(['Nightmare 6+ Players']);
  });
});

describe('groupPlayerRaidPbs', () => {
  function pb(boss: string, timeSeconds: number, rank = 1, updatedAt = '2026-07-08T00:00:00.000Z') {
    return { boss, timeSeconds, rank, updatedAt };
  }

  it('summarizes a mode with only Overall variants by its fastest one', () => {
    const pbs = [
      pb('chambers of xeric - challenge mode - fastest overall (solo)', 2000, 3, '2026-07-01T00:00:00.000Z'),
      pb('chambers of xeric - challenge mode - fastest overall (3 players)', 1000, 1, '2026-07-02T00:00:00.000Z'),
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'Chambers Of Xeric - Challenge Mode');
    expect(group?.summary).toEqual({
      key: 'chambers of xeric - challenge mode - fastest overall (3 players)',
      label: 'Trio',
      kind: 'Overall',
      timeSeconds: 1000,
      rank: 1,
      updatedAt: '2026-07-02T00:00:00.000Z',
    });
  });

  it('ignores faster Room times when an Overall variant is present, since Room is a different metric', () => {
    const pbs = [
      pb('theatre of blood - fastest room (3 player)', 500, 1),
      pb('theatre of blood - fastest overall (3 player)', 1200, 2),
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'Theatre Of Blood');
    expect(group?.summary.key).toBe('theatre of blood - fastest overall (3 player)');
    expect(group?.summary.kind).toBe('Overall');
  });

  it('falls back to the fastest available kind when a mode has no Overall variant', () => {
    const pbs = [
      pb('tombs of amascut - fastest room (2 player)', 900, 4),
      pb('tombs of amascut - fastest room (solo)', 1100, 2),
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'Tombs Of Amascut');
    expect(group?.summary.kind).toBe('Room');
    expect(group?.summary.key).toBe('tombs of amascut - fastest room (2 player)');
  });

  it('groups The Nightmare the same as a raid, even though it is not categorized as one', () => {
    const pbs = [
      pb('the nightmare - fastest overall (solo)', 900, 1),
      pb('the nightmare - fastest overall (2 players)', 700, 1),
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'The Nightmare');
    expect(group?.summary.key).toBe('the nightmare - fastest overall (2 players)');
    expect(group?.variants.map((v) => v.label)).toEqual(['Solo', 'Duo']);
  });

  it('passes non-grouped bosses through untouched as flat entries', () => {
    const pbs = [pb('zulrah', 80, 1), pb('vorkath', 143, 5)];
    const { groups, flat } = groupPlayerRaidPbs(pbs);
    expect(groups).toEqual([]);
    expect(flat).toEqual(pbs);
  });

  it('disambiguates Room vs Overall labels when a mode has both for the same team size', () => {
    // Real bug seen on production: Tombs of Amascut - Expert tracks both a
    // Room time and an Overall time per team size, so without
    // disambiguation two different times both render as the bare size
    // nickname (e.g. two unlabeled "4-Man" rows), indistinguishable in the
    // UI.
    const pbs = [
      pb('tombs of amascut - expert - fastest overall (4 player)', 2002, 8),
      pb('tombs of amascut - expert - fastest room (4 player)', 1745, 8),
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'Tombs Of Amascut - Expert');
    const labels = group?.variants.map((v) => v.label);
    expect(new Set(labels).size).toBe(labels?.length);
    // Dash-separated rather than "4-Man (Overall)" - the summary row already
    // wraps this label in its own parens ("29:58 (...)"), and nesting a
    // second pair inside it read as a doubled/broken-looking parenthetical.
    expect(labels).toEqual(['4-Man - Overall', '4-Man - Room']);
    // The summary row is a single number with no adjacent counterpart to
    // confuse it with, so it keeps the plain size label rather than also
    // getting the disambiguation suffix (which read as redundant: "8-Man -
    // Overall" when Overall is already the expected/default kind).
    expect(group?.summary.label).toBe('4-Man');
  });

  it('does not add a kind suffix when a mode only has one kind of variant', () => {
    const pbs = [
      pb('chambers of xeric - challenge mode - fastest overall (solo)', 2000, 3),
      pb('chambers of xeric - challenge mode - fastest overall (3 players)', 1000, 1),
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'Chambers Of Xeric - Challenge Mode');
    expect(group?.variants.map((v) => v.label)).toEqual(['Solo', 'Trio']);
  });

  it('does not suffix labels that do not actually collide, even in a group that mixes kinds', () => {
    // Real bug seen on production: disambiguating whenever a group merely
    // *contained* more than one kind (rather than only when two labels
    // actually collide) produced silly-looking results - a lone bare
    // "Overall" entry became "Overall - Overall", and a Legacy "(Former)"
    // entry (already a unique, self-describing label) became
    // "Fastest Room (Former) - Legacy" for no reason.
    const pbs = [
      pb('theatre of blood', 1200, 1), // bare Overall - unique, no Room counterpart
      pb('theatre of blood - fastest overall (3 player)', 1100, 2),
      pb('theatre of blood - fastest room (3 player)', 500, 1), // collides with the line above
      pb('theatre of blood - fastest room (former)', 900, 3), // unique Legacy label
    ];
    const { groups } = groupPlayerRaidPbs(pbs);
    const group = groups.find((g) => g.heading === 'Theatre Of Blood');
    const labels = group?.variants.map((v) => v.label);
    // Sorted by team size first, so the sized Trio pair comes before the
    // team-size-less bare Overall/Legacy entries.
    expect(labels).toEqual(['Trio - Overall', 'Trio - Room', 'Overall', 'Fastest Room (Former)']);
  });
});

describe('groupVariantsByKind', () => {
  it('keeps bare Overall raid keys in the Overall type group', () => {
    const groups = groupVariantsByKind([
      { key: 'k1', label: 'Fastest Overall (Solo)' },
      { key: 'k2', label: 'Overall' },
    ]);

    expect(groups.map((g) => g.kind)).toEqual(['Overall']);
    expect(groups[0].variants.map((v) => v.sizeLabel)).toEqual(['Solo', 'Overall']);
  });

  it('splits Overall/Room into their own groups, sorted and relabeled by team size', () => {
    const variants = [
      { key: 'k1', label: 'Fastest Overall (Solo)' },
      { key: 'k2', label: 'Fastest Room (Solo)' },
      { key: 'k3', label: 'Fastest Overall (2 Player)' },
      { key: 'k4', label: 'Fastest Room (2 Player)' },
    ];
    const groups = groupVariantsByKind(variants);
    expect(groups.map((g) => g.kind)).toEqual(['Overall', 'Room']);

    const overall = groups.find((g) => g.kind === 'Overall');
    expect(overall?.variants.map((v) => v.sizeLabel)).toEqual(['Solo', 'Duo']);

    const room = groups.find((g) => g.kind === 'Room');
    expect(room?.variants.map((v) => v.sizeLabel)).toEqual(['Solo', 'Duo']);
  });

  it('names larger team sizes "N-Man" and strips mode suffixes like "Entry Mode"', () => {
    const variants = [{ key: 'k1', label: 'Fastest Overall (1 Player Entry Mode)' }, { key: 'k2', label: 'Fastest Room (8 Player)' }];
    const groups = groupVariantsByKind(variants);
    expect(groups.find((g) => g.kind === 'Overall')?.variants[0].sizeLabel).toBe('Solo');
    expect(groups.find((g) => g.kind === 'Room')?.variants[0].sizeLabel).toBe('8-Man');
  });

  it('labels a capped/mass size like "6+ Players" as "6+" and sorts it after 5-Man', () => {
    const variants = [
      { key: 'k1', label: 'Fastest Overall (6+ Players)' },
      { key: 'k2', label: 'Fastest Overall (5 Players)' },
      { key: 'k3', label: 'Fastest Overall (Solo)' },
    ];
    const groups = groupVariantsByKind(variants);
    const overall = groups.find((g) => g.kind === 'Overall');
    expect(overall?.variants.map((v) => v.sizeLabel)).toEqual(['Solo', '5-Man', '6+']);
  });

  it('buckets all legacy "(Former)" entries together into their own Legacy group, regardless of Room/Wave wording, falling back to the full label', () => {
    const variants = [
      { key: 'k1', label: 'Fastest Room (Former)' },
      { key: 'k2', label: 'Fastest Wave (Former)' },
      { key: 'k3', label: 'Fastest Overall (Solo)' },
    ];
    const groups = groupVariantsByKind(variants);
    expect(groups.map((g) => g.kind)).toEqual(['Overall', 'Legacy']);
    expect(groups.find((g) => g.kind === 'Legacy')?.variants).toEqual([
      { key: 'k1', label: 'Fastest Room (Former)', sizeLabel: 'Fastest Room (Former)' },
      { key: 'k2', label: 'Fastest Wave (Former)', sizeLabel: 'Fastest Wave (Former)' },
    ]);
  });
});
