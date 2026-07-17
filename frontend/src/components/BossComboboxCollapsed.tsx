import { useEffect, useMemo, useRef, useState } from 'react';
import { titleCase } from '../lib/format';
import { basesFromGroups, groupBosses } from '../lib/bossGroups';

type Row =
  | { type: 'category-heading'; label: string }
  | { type: 'raid-base'; base: string; label: string }
  | { type: 'option'; key: string; label: string };

// Grouped multi-variant bosses (raids, The Nightmare, ...) collapse to one
// "choose variant" row each; everything else in the category is a flat
// option. Both kinds are merged and sorted together by label so a grouped
// boss lands in its normal alphabetical spot instead of being pulled out to
// the top or bottom of its category.
function buildRows(bosses: string[]): Row[] {
  const rows: Row[] = [];
  for (const group of groupBosses(bosses)) {
    rows.push({ type: 'category-heading', label: group.category });
    const baseRows: Row[] = basesFromGroups(group.raidGroups ?? []).map((b) => ({
      type: 'raid-base',
      base: b.base,
      label: b.label,
    }));
    const itemRows: Row[] = (group.items ?? []).map((item) => ({
      type: 'option',
      key: item.key,
      label: item.label,
    }));
    rows.push(...[...baseRows, ...itemRows].sort((a, b) => a.label.localeCompare(b.label)));
  }
  return rows;
}

function buildFilteredRows(bosses: string[], filter: string): Row[] {
  return buildRows(bosses.filter((boss) => boss.toLowerCase().includes(filter.toLowerCase())));
}

export function BossComboboxCollapsed({
  bosses,
  selected,
  onSelect,
  onSelectRaidBase,
}: {
  bosses: string[];
  selected?: string;
  onSelect: (boss: string) => void;
  onSelectRaidBase: (base: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () => (filter ? buildFilteredRows(bosses, filter) : buildRows(bosses)),
    [bosses, filter]
  );
  const navigable = useMemo(() => rows.filter((r) => r.type !== 'category-heading'), [rows]);

  useEffect(() => {
    if (!open) return;
    setFilter('');
    setActive(0);
    inputRef.current?.focus();
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  const activate = (row: Row) => {
    if (row.type === 'option') {
      onSelect(row.key);
      setOpen(false);
    } else if (row.type === 'raid-base') {
      onSelectRaidBase(row.base);
      setOpen(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, navigable.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && navigable[active]) {
      e.preventDefault();
      activate(navigable[active]);
    }
  };

  return (
    <div className="combobox" ref={rootRef}>
      <button
        type="button"
        className="combobox-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected ? '' : 'placeholder'}>
          {selected ? titleCase(selected) : bosses.length === 0 ? 'No PB data synced yet' : 'Select a boss...'}
        </span>
      </button>
      {open && (
        <div className="combobox-panel" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            className="combobox-filter"
            placeholder="Search bosses..."
            aria-label="Filter bosses"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setActive(0);
            }}
          />
          <div className="combobox-options" role="listbox">
            {navigable.length === 0 && <div className="combobox-empty">No matching bosses</div>}
            {(() => {
              let navIndex = -1;
              return rows.map((row, i) => {
                if (row.type === 'category-heading') {
                  return (
                    <div key={`cat-${i}`} className="combobox-category-heading" role="presentation">
                      {row.label}
                    </div>
                  );
                }
                navIndex += 1;
                const idx = navIndex;
                if (row.type === 'raid-base') {
                  return (
                    <div
                      key={row.base}
                      role="option"
                      aria-selected={idx === active}
                      className={`combobox-option combobox-raid-drill${idx === active ? ' active' : ''}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => activate(row)}
                    >
                      <span>{row.label}</span>
                      <span className="combobox-count">choose variant ›</span>
                    </div>
                  );
                }
                return (
                  <div
                    key={row.key}
                    role="option"
                    aria-selected={idx === active}
                    className={`combobox-option${idx === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => activate(row)}
                  >
                    {row.label}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
