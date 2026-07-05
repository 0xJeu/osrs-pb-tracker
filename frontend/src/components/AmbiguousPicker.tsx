import { useRef } from 'react';
import type { AmbiguousMatch } from '../lib/api';
import { formatDate } from '../lib/format';

export function AmbiguousPicker({
  name,
  matches,
  onPick,
}: {
  name: string;
  matches: AmbiguousMatch[];
  onPick: (id: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll('button') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown' ? Math.min(current + 1, buttons.length - 1) : Math.max(current - 1, 0);
    buttons[next]?.focus();
  };

  return (
    <div>
      <div className="state">
        Multiple synced players are using the name <strong>{name}</strong> (renames happen). Pick
        the one you meant:
      </div>
      <div className="match-list" ref={listRef} onKeyDown={onKeyDown}>
        {matches.map((m) => (
          <button key={m.id} type="button" className="match-option" onClick={() => onPick(m.id)}>
            <span>{m.displayName}</span>
            <span className="match-meta">last synced {formatDate(m.updatedAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
