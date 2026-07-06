import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

const SUGGEST_DEBOUNCE_MS = 200;

export function SearchBar({
  initialValue = '',
  onSubmit,
}: {
  initialValue?: string;
  onSubmit: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const suppressNextFetch = useRef(false);

  useEffect(() => {
    if (suppressNextFetch.current) {
      suppressNextFetch.current = false;
      return;
    }
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.search(q).then(setSuggestions).catch(() => setSuggestions([]));
    }, SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  const submit = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSuggestions([]);
    onSubmit(trimmed);
  };

  return (
    <section className="search-card">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Look up a player, e.g. Blitzen"
          aria-label="Player name"
        />
        <button type="submit">Search</button>
      </form>
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                suppressNextFetch.current = true;
                setValue(n);
                submit(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
