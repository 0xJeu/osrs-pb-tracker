import { describe, expect, it } from 'vitest';
import { categorize, getRaidBases, getRaidModes, groupBosses, groupVariantsByKind, isGroupedVariant } from '../src/lib/bossGroups';

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
  it('is true for raid keys and The Nightmare, false for everything else', () => {
    expect(isGroupedVariant('chambers of xeric - fastest overall (solo)')).toBe(true);
    expect(isGroupedVariant('the nightmare - fastest overall (solo)')).toBe(true);
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
