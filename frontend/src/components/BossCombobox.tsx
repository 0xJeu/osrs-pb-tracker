import { useEffect, useRef, useState } from 'react';
import { titleCase } from '../lib/format';

export function BossCombobox({
  bosses,
  selected,
  onSelect,
}: {
  bosses: string[];
  selected?: string;
  onSelect: (boss: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = bosses.filter((b) => b.toLowerCase().includes(filter.toLowerCase()));

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

  const choose = (boss: string) => {
    onSelect(boss);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, visible.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter' && visible[active]) {
      e.preventDefault();
      choose(visible[active]);
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
            {visible.length === 0 && <div className="combobox-empty">No matching bosses</div>}
            {visible.map((b, i) => (
              <div
                key={b}
                role="option"
                aria-selected={i === active}
                className={`combobox-option${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(b)}
              >
                {titleCase(b)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
