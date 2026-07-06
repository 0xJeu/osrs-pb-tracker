import { useEffect, useMemo, useState } from 'react';
import { getRaidModes, groupVariantsByKind } from '../lib/bossGroups';

export function RaidVariantPicker({
  base,
  bosses,
  selected,
  onSelect,
}: {
  base: string;
  bosses: string[];
  selected?: string;
  onSelect: (boss: string) => void;
}) {
  const modes = useMemo(() => getRaidModes(bosses, base), [bosses, base]);
  const [modeIndex, setModeIndex] = useState(0);
  const mode = modes[modeIndex] ?? modes[0];

  const kindGroups = useMemo(() => groupVariantsByKind(mode?.variants ?? []), [mode]);
  const [kindIndex, setKindIndex] = useState(0);
  const kindGroup = kindGroups[kindIndex] ?? kindGroups[0];

  useEffect(() => {
    if (!selected) return;

    const selectedModeIndex = modes.findIndex((m) => m.variants.some((v) => v.key === selected));
    if (selectedModeIndex === -1) return;

    const selectedKindGroups = groupVariantsByKind(modes[selectedModeIndex].variants);
    const selectedKindIndex = selectedKindGroups.findIndex((kg) => kg.variants.some((v) => v.key === selected));

    setModeIndex(selectedModeIndex);
    setKindIndex(selectedKindIndex === -1 ? 0 : selectedKindIndex);
  }, [modes, selected]);

  return (
    <section className="raid-variant-switcher">
      {modes.length > 1 && (
        <div className="raid-mode-tabs">
          {modes.map((m, i) => (
            <button
              key={m.modeLabel}
              type="button"
              className={`raid-mode-tab${i === modeIndex ? ' active' : ''}`}
              onClick={() => {
                setModeIndex(i);
                setKindIndex(0);
              }}
            >
              {m.modeLabel}
            </button>
          ))}
        </div>
      )}
      {kindGroups.length > 1 && (
        <div className="raid-kind-tabs">
          {kindGroups.map((kg, i) => (
            <button
              key={kg.kind}
              type="button"
              className={`raid-kind-tab${i === kindIndex ? ' active' : ''}`}
              onClick={() => setKindIndex(i)}
            >
              {kg.kind}
            </button>
          ))}
        </div>
      )}
      <div className="raid-variant-grid">
        {kindGroup?.variants.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`raid-variant-button${v.key === selected ? ' active' : ''}`}
            onClick={() => onSelect(v.key)}
          >
            {v.sizeLabel}
          </button>
        ))}
      </div>
    </section>
  );
}
