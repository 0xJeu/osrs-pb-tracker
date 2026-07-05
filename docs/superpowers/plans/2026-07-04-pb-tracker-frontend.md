# PB Tracker Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `website/` prototype with a Vite + React + TypeScript SPA in `frontend/`, deployable to Vercel as static assets, preserving today's player-lookup and boss-leaderboard flows against the existing (frozen) API contract.

**Architecture:** Single-page app with three view states (home/search, player result, boss leaderboard) driven by `?player=` / `?boss=` URL params. All API access goes through one client module (`src/lib/api.ts`) whose base URL comes from `VITE_API_BASE_URL` (unset → same-origin `/api/...`). Formatting/dedup logic is ported verbatim from `website/app.js` into pure, unit-tested lib functions.

**Tech Stack:** Vite 5, React 18, TypeScript, Vitest (lib unit tests), Playwright (smoke tests with mocked API routes).

Full design rationale: `docs/superpowers/specs/2026-07-04-pb-tracker-frontend-design.md`.

---

## File Structure

```
frontend/
  package.json
  tsconfig.json
  vite.config.ts          # Vite + react plugin + vitest config (excludes e2e/)
  playwright.config.ts    # webServer + e2e/ testDir
  index.html
  vercel.json             # buildCommand/outputDirectory (Task 10)
  .env.example            # documents VITE_API_BASE_URL
  .gitignore
  src/
    main.tsx              # ReactDOM bootstrap, imports theme.css
    App.tsx               # view state + URL routing, composes everything
    theme.css             # dark OSRS theme, mobile stacked rows
    lib/
      format.ts           # formatTime, formatDate, titleCase (ported from app.js)
      dedupe.ts           # hideAmbiguousBaseEntries (ported from app.js)
      api.ts              # types + createApiClient factory + default singleton
    components/
      States.tsx          # Loading / ErrorState / EmptyState
      SearchBar.tsx       # debounced suggestions
      AmbiguousPicker.tsx # arrow-key navigable match list
      PlayerResult.tsx    # lookup by name, handles all sub-states
      BossCombobox.tsx    # searchable, keyboard-navigable
      Leaderboard.tsx     # top times table
  test/
    format.test.ts
    dedupe.test.ts
    api.test.ts
  e2e/
    smoke.spec.ts         # 6 Playwright smoke tests, mocked routes
```

React escapes all rendered strings by default, which satisfies the spec's
"escape or safely render all display-name values" requirement — no `dangerouslySetInnerHTML` anywhere in this plan.

---

### Task 1: Scaffold the project

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx` (placeholder, replaced in Task 7)
- Create: `frontend/src/theme.css` (minimal, replaced in Task 8)
- Create: `frontend/.env.example`
- Create: `frontend/.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pb-tracker-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "test", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
```

- [ ] **Step 4: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>OSRS PB Tracker</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: Create src/main.tsx**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './theme.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Create placeholder src/App.tsx**

```tsx
export default function App() {
  return <p>PB Tracker frontend scaffold</p>;
}
```

- [ ] **Step 7: Create minimal src/theme.css**

```css
:root {
  --bg: #14100c;
  --text: #e8ded0;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}
```

- [ ] **Step 8: Create .env.example**

```
# Base URL of the PB tracker API. Leave unset for same-origin /api/... paths.
# Local dev against the Hono backend:  http://localhost:3000
# Production:                          https://osrs-pb-tracker-backend.vercel.app
VITE_API_BASE_URL=http://localhost:3000
```

- [ ] **Step 9: Create frontend/.gitignore**

```
node_modules/
dist/
.env
.env.local
playwright-report/
test-results/
```

- [ ] **Step 10: Install and verify boot**

Run: `cd frontend && npm install`
Expected: installs cleanly, `package-lock.json` created.

Run: `cd frontend && timeout 6 npm run dev` (or start and Ctrl+C once confirmed)
Expected: Vite prints a local URL, no errors. The placeholder text renders if opened.

- [ ] **Step 11: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/src/main.tsx frontend/src/App.tsx frontend/src/theme.css frontend/.env.example frontend/.gitignore
git commit -m "Scaffold Vite + React frontend"
```

---

### Task 2: Formatting helpers (TDD)

**Files:**
- Create: `frontend/src/lib/format.ts`
- Test: `frontend/test/format.test.ts`

These are direct ports from `website/app.js` — the expected values below are the
exact behavior of the live prototype (verified against real data: brutus 5s →
"0:05", zulrah 80s → "1:20", ToB 1238s → "20:38", vorkath 94.2s → "1:34.20").

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/format.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatTime, formatDate, titleCase } from '../src/lib/format';

describe('formatTime', () => {
  it('formats sub-minute times', () => {
    expect(formatTime(5)).toBe('0:05');
  });

  it('formats minute times', () => {
    expect(formatTime(80)).toBe('1:20');
    expect(formatTime(1238)).toBe('20:38');
  });

  it('formats hour-plus times as h:mm:ss', () => {
    expect(formatTime(3725)).toBe('1:02:05');
  });

  it('keeps two decimals only for fractional seconds', () => {
    expect(formatTime(94.2)).toBe('1:34.20');
    expect(formatTime(118.4)).toBe('1:58.40');
    expect(formatTime(90)).toBe('1:30');
  });
});

describe('formatDate', () => {
  it('renders a valid ISO date via toLocaleString', () => {
    const iso = '2026-07-04T18:00:00.000Z';
    expect(formatDate(iso)).toBe(new Date(iso).toLocaleString());
  });

  it('falls back to the raw value for unparseable input', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('titleCase', () => {
  it('capitalizes each word', () => {
    expect(titleCase('theatre of blood')).toBe('Theatre Of Blood');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run test/format.test.ts`
Expected: FAIL — cannot resolve `../src/lib/format`.

- [ ] **Step 3: Implement lib/format.ts**

```typescript
// Ported verbatim from website/app.js so the rewrite renders times and dates
// identically to the prototype users already know.

export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const hasFraction = Math.abs(s - Math.round(s)) > 0.001;
  const secStr = hasFraction
    ? s.toFixed(2).padStart(5, '0')
    : String(Math.round(s)).padStart(2, '0');

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${secStr}`;
  }
  return `${m}:${secStr}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function titleCase(str: string): string {
  return str.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run test/format.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/lib/format.ts frontend/test/format.test.ts
git commit -m "Add time/date/title formatting helpers with tests"
```

---

### Task 3: Raid-variant dedup helper (TDD)

**Files:**
- Create: `frontend/src/lib/dedupe.ts`
- Test: `frontend/test/dedupe.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/dedupe.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { hideAmbiguousBaseEntries } from '../src/lib/dedupe';

describe('hideAmbiguousBaseEntries', () => {
  it('hides a bare base entry when a more specific variant exists', () => {
    const items = ['theatre of blood', 'theatre of blood - fastest room (4 player)'];
    expect(hideAmbiguousBaseEntries(items, (x) => x)).toEqual([
      'theatre of blood - fastest room (4 player)',
    ]);
  });

  it('keeps entries with no more-specific variant', () => {
    const items = ['zulrah', 'vorkath'];
    expect(hideAmbiguousBaseEntries(items, (x) => x)).toEqual(['zulrah', 'vorkath']);
  });

  it('compares case-insensitively', () => {
    const items = ['Theatre Of Blood', 'theatre of blood - fastest room'];
    expect(hideAmbiguousBaseEntries(items, (x) => x)).toEqual([
      'theatre of blood - fastest room',
    ]);
  });

  it('works through an accessor for object items', () => {
    const items = [
      { boss: 'tombs of amascut', timeSeconds: 1535 },
      { boss: 'tombs of amascut - fastest room (4 player)', timeSeconds: 1641 },
    ];
    expect(hideAmbiguousBaseEntries(items, (x) => x.boss)).toEqual([items[1]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run test/dedupe.test.ts`
Expected: FAIL — cannot resolve `../src/lib/dedupe`.

- [ ] **Step 3: Implement lib/dedupe.ts**

```typescript
// Raids report multiple records under a shared base name (e.g. "Theatre of
// Blood", "Theatre of Blood - Fastest Room (4 player)"). The bare base entry
// is ambiguous once a more specific variant exists, so we hide it rather than
// show a number that might be misleading. Ported verbatim from website/app.js.
export function hideAmbiguousBaseEntries<T>(items: T[], getName: (item: T) => string): T[] {
  const names = items.map((item) => getName(item).toLowerCase());
  return items.filter((item) => {
    const lower = getName(item).toLowerCase();
    const hasMoreSpecificVariant = names.some((n) => n !== lower && n.startsWith(lower + ' '));
    return !hasMoreSpecificVariant;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run test/dedupe.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/lib/dedupe.ts frontend/test/dedupe.test.ts
git commit -m "Add raid-variant dedup helper with tests"
```

---

### Task 4: API client (TDD)

**Files:**
- Create: `frontend/src/lib/api.ts`
- Test: `frontend/test/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/test/api.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/lib/api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('strips trailing slashes from the base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('http://api.test///', fetchFn);
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/api/bosses');
  });

  it('uses same-origin relative paths for an empty base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledWith('/api/bosses');
  });

  it('maps a 404 player lookup to notFound', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Player not found' }, 404));
    const api = createApiClient('', fetchFn);
    expect(await api.lookupPlayer('Nobody')).toEqual({ kind: 'notFound' });
  });

  it('maps an ambiguous response to its matches', async () => {
    const matches = [{ id: 1, displayName: 'Blitzen', updatedAt: '2026-07-04T00:00:00Z' }];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ambiguous: true, matches }));
    const api = createApiClient('', fetchFn);
    expect(await api.lookupPlayer('Blitzen')).toEqual({ kind: 'ambiguous', matches });
  });

  it('maps a full payload to a player result', async () => {
    const player = {
      id: 1,
      displayName: 'Blitzen',
      updatedAt: '2026-07-04T00:00:00Z',
      pbs: [{ boss: 'zulrah', timeSeconds: 80, updatedAt: '2026-07-04T00:00:00Z' }],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(player));
    const api = createApiClient('', fetchFn);
    expect(await api.lookupPlayer('Blitzen')).toEqual({ kind: 'player', player });
  });

  it('URL-encodes names and bosses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.getLeaderboard('theatre of blood - fastest room (4 player)');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/leaderboard/theatre%20of%20blood%20-%20fastest%20room%20(4%20player)?limit=25'
    );
  });

  it('throws on unexpected server errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Internal error' }, 500));
    const api = createApiClient('', fetchFn);
    await expect(api.getBosses()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: FAIL — cannot resolve `../src/lib/api`.

- [ ] **Step 3: Implement lib/api.ts**

```typescript
export interface PbEntry {
  boss: string;
  timeSeconds: number;
  updatedAt: string;
}

export interface PlayerPayload {
  id: number;
  displayName: string;
  updatedAt: string;
  pbs: PbEntry[];
}

export interface AmbiguousMatch {
  id: number;
  displayName: string;
  updatedAt: string;
}

export type PlayerLookup =
  | { kind: 'player'; player: PlayerPayload }
  | { kind: 'ambiguous'; matches: AmbiguousMatch[] }
  | { kind: 'notFound' };

export interface LeaderboardRow {
  displayName: string;
  timeSeconds: number;
  updatedAt: string;
}

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API error ${status}`);
  }
}

export function createApiClient(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, '');

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetchFn(`${base}${path}`);
    if (!res.ok) {
      throw new ApiError(res.status);
    }
    return res.json() as Promise<T>;
  }

  async function playerFrom(res: Response): Promise<PlayerLookup> {
    if (res.status === 404) {
      return { kind: 'notFound' };
    }
    if (!res.ok) {
      throw new ApiError(res.status);
    }
    const data = await res.json();
    if (data.ambiguous) {
      return { kind: 'ambiguous', matches: data.matches as AmbiguousMatch[] };
    }
    return { kind: 'player', player: data as PlayerPayload };
  }

  return {
    async lookupPlayer(name: string): Promise<PlayerLookup> {
      return playerFrom(await fetchFn(`${base}/api/players/${encodeURIComponent(name)}`));
    },
    async getPlayerById(id: number): Promise<PlayerLookup> {
      return playerFrom(await fetchFn(`${base}/api/players/by-id/${id}`));
    },
    search(q: string): Promise<string[]> {
      return getJson(`/api/search?q=${encodeURIComponent(q)}`);
    },
    getBosses(): Promise<string[]> {
      return getJson('/api/bosses');
    },
    getLeaderboard(boss: string, limit = 25): Promise<LeaderboardRow[]> {
      return getJson(`/api/leaderboard/${encodeURIComponent(boss)}?limit=${limit}`);
    },
  };
}

// Default client. VITE_API_BASE_URL unset -> same-origin /api/... paths,
// per the spec's defined fallback behavior.
export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? '');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full unit suite and typecheck**

Run: `cd frontend && npm test && npx tsc --noEmit`
Expected: all tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/lib/api.ts frontend/test/api.test.ts
git commit -m "Add typed API client with tests"
```

---

### Task 5: Player-flow components

**Files:**
- Create: `frontend/src/components/States.tsx`
- Create: `frontend/src/components/SearchBar.tsx`
- Create: `frontend/src/components/AmbiguousPicker.tsx`
- Create: `frontend/src/components/PlayerResult.tsx`

No unit tests in this task — these components are covered by the Playwright
smoke suite in Task 9, per the spec's testing split (Vitest for lib logic,
Playwright for flows). Verification here is typecheck + Task 7's live render.

- [ ] **Step 1: Create components/States.tsx**

```tsx
import type { ReactNode } from 'react';

export function Loading() {
  return <div className="state">Loading…</div>;
}

// Error copy is written for end users, per the spec - never
// "is the backend running?"
export function ErrorState() {
  return <div className="state state-error">Couldn't load data — try again shortly.</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}
```

- [ ] **Step 2: Create components/SearchBar.tsx**

```tsx
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
  // Selecting a suggestion sets the input value, which would immediately
  // refetch suggestions for the just-selected name - suppress that one cycle.
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
```

- [ ] **Step 3: Create components/AmbiguousPicker.tsx**

```tsx
import { useRef } from 'react';
import type { AmbiguousMatch } from '../lib/api';
import { formatDate } from '../lib/format';

// Display names aren't unique (renames, reused names), so a lookup can match
// multiple player rows. List them and let the user pick. Arrow keys move
// focus between options per the spec's keyboard-accessibility requirement;
// buttons already handle Enter/Space natively.
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
```

- [ ] **Step 4: Create components/PlayerResult.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AmbiguousMatch, PlayerPayload } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { AmbiguousPicker } from './AmbiguousPicker';
import { EmptyState, ErrorState, Loading } from './States';

type State =
  | { s: 'loading' }
  | { s: 'error' }
  | { s: 'notFound' }
  | { s: 'ambiguous'; matches: AmbiguousMatch[] }
  | { s: 'loaded'; player: PlayerPayload };

export function PlayerResult({ name }: { name: string }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .lookupPlayer(name)
      .then((result) => {
        if (!alive) return;
        if (result.kind === 'notFound') setState({ s: 'notFound' });
        else if (result.kind === 'ambiguous') setState({ s: 'ambiguous', matches: result.matches });
        else setState({ s: 'loaded', player: result.player });
      })
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [name]);

  const pickById = (id: number) => {
    setState({ s: 'loading' });
    api
      .getPlayerById(id)
      .then((result) => {
        if (result.kind === 'player') setState({ s: 'loaded', player: result.player });
        else setState({ s: 'notFound' });
      })
      .catch(() => setState({ s: 'error' }));
  };

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;
  if (state.s === 'notFound') {
    return (
      <EmptyState>
        No PB data found for <strong>{name}</strong> yet. They need to sync with the PB Tracker
        Sync plugin first.
      </EmptyState>
    );
  }
  if (state.s === 'ambiguous') {
    return <AmbiguousPicker name={name} matches={state.matches} onPick={pickById} />;
  }

  const { player } = state;
  if (player.pbs.length === 0) {
    return (
      <EmptyState>
        <strong>{player.displayName}</strong> has synced, but has no recorded PBs yet.
      </EmptyState>
    );
  }

  const visiblePbs = hideAmbiguousBaseEntries(player.pbs, (pb) => pb.boss);

  return (
    <section>
      <h2 className="result-title">{player.displayName}</h2>
      <div className="result-meta">
        Last synced {formatDate(player.updatedAt)} · {visiblePbs.length} PB(s) recorded
      </div>
      <table>
        <thead>
          <tr>
            <th>Boss</th>
            <th>Personal Best</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
          {visiblePbs.map((pb) => (
            <tr key={pb.boss}>
              <td data-label="Boss">{titleCase(pb.boss)}</td>
              <td data-label="Personal Best" className="time">
                {formatTime(pb.timeSeconds)}
              </td>
              <td data-label="Recorded">{formatDate(pb.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/components/States.tsx frontend/src/components/SearchBar.tsx frontend/src/components/AmbiguousPicker.tsx frontend/src/components/PlayerResult.tsx
git commit -m "Add player-flow components"
```

---

### Task 6: Boss-flow components

**Files:**
- Create: `frontend/src/components/BossCombobox.tsx`
- Create: `frontend/src/components/Leaderboard.tsx`

- [ ] **Step 1: Create components/BossCombobox.tsx**

```tsx
import { useEffect, useRef, useState } from 'react';
import { titleCase } from '../lib/format';

// Searchable, keyboard-navigable combobox: ArrowUp/Down move the active
// option, Enter selects it, Escape closes, click-outside closes. This is the
// accessibility upgrade over the prototype's mouse-only combobox required by
// the spec.
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
          {selected ? titleCase(selected) : bosses.length === 0 ? 'No PB data synced yet' : 'Select a boss…'}
        </span>
      </button>
      {open && (
        <div className="combobox-panel" onKeyDown={onKeyDown}>
          <input
            ref={inputRef}
            className="combobox-filter"
            placeholder="Search bosses…"
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
```

- [ ] **Step 2: Create components/Leaderboard.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardRow } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type State = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; rows: LeaderboardRow[] };

export function Leaderboard({ boss }: { boss: string }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .getLeaderboard(boss)
      .then((rows) => alive && setState({ s: 'loaded', rows }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [boss]);

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;
  if (state.rows.length === 0) {
    return (
      <EmptyState>
        No synced PBs for <strong>{titleCase(boss)}</strong> yet.
      </EmptyState>
    );
  }

  return (
    <section>
      <h2 className="result-title">{titleCase(boss)} — Top times</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Personal Best</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r, i) => (
            <tr key={`${r.displayName}-${i}`}>
              <td className="rank" data-label="#">
                {i + 1}
              </td>
              <td data-label="Player">{r.displayName}</td>
              <td className="time" data-label="Personal Best">
                {formatTime(r.timeSeconds)}
              </td>
              <td data-label="Recorded">{formatDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/components/BossCombobox.tsx frontend/src/components/Leaderboard.tsx
git commit -m "Add boss-flow components"
```

---

### Task 7: App shell with URL-driven view state

**Files:**
- Modify: `frontend/src/App.tsx` (replace the Task 1 placeholder entirely)

- [ ] **Step 1: Replace src/App.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { hideAmbiguousBaseEntries } from './lib/dedupe';
import { SearchBar } from './components/SearchBar';
import { BossCombobox } from './components/BossCombobox';
import { PlayerResult } from './components/PlayerResult';
import { Leaderboard } from './components/Leaderboard';
import { EmptyState } from './components/States';

type View =
  | { name: 'home' }
  | { name: 'player'; player: string }
  | { name: 'boss'; boss: string };

// ?player= takes precedence over ?boss= when both are present, matching the
// prototype's behavior (documented in the spec).
function viewFromLocation(): View {
  const params = new URLSearchParams(window.location.search);
  const player = params.get('player');
  const boss = params.get('boss');
  if (player) return { name: 'player', player };
  if (boss) return { name: 'boss', boss };
  return { name: 'home' };
}

export default function App() {
  const [view, setView] = useState<View>(viewFromLocation);
  const [bosses, setBosses] = useState<string[]>([]);

  useEffect(() => {
    api
      .getBosses()
      .then((all) => setBosses(hideAmbiguousBaseEntries(all, (b) => b)))
      .catch(() => setBosses([]));
  }, []);

  useEffect(() => {
    const onPop = () => setView(viewFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next: View) => {
    const url = new URL(window.location.href);
    url.search = '';
    if (next.name === 'player') url.searchParams.set('player', next.player);
    if (next.name === 'boss') url.searchParams.set('boss', next.boss);
    window.history.pushState({}, '', url);
    setView(next);
  };

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <h1>
            <span className="accent">PB</span> Tracker
          </h1>
          <p className="subtitle">Old School RuneScape boss personal best records</p>
        </div>
      </header>

      <main className="wrap">
        <SearchBar
          key={view.name === 'player' ? view.player : 'blank'}
          initialValue={view.name === 'player' ? view.player : ''}
          onSubmit={(name) => navigate({ name: 'player', player: name })}
        />

        <section className="boss-select-card">
          <label>Or browse a leaderboard</label>
          <BossCombobox
            bosses={bosses}
            selected={view.name === 'boss' ? view.boss : undefined}
            onSelect={(boss) => navigate({ name: 'boss', boss })}
          />
        </section>

        <section id="results">
          {view.name === 'home' && (
            <EmptyState>
              Search a player above, or pick a boss to see the leaderboard. Data appears after a
              player syncs with the PB Tracker Sync RuneLite plugin.
            </EmptyState>
          )}
          {view.name === 'player' && <PlayerResult name={view.player} />}
          {view.name === 'boss' && <Leaderboard boss={view.boss} />}
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          Data synced from the <strong>PB Tracker Sync</strong> RuneLite plugin.
        </div>
      </footer>
    </>
  );
}
```

- [ ] **Step 2: Typecheck and run all unit tests**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: clean, all tests pass.

- [ ] **Step 3: Manual render check against the local backend**

Start the Hono backend (`cd backend-hono && npm run dev`), then in another
terminal: `cd frontend && npm run dev` (with `frontend/.env` containing
`VITE_API_BASE_URL=http://localhost:3000`). Open the Vite URL. Expected: the
app renders header/search/combobox, the boss list populates from the real API,
and searching a synced player shows their PB table. Unstyled-but-functional is
the bar here; Task 8 brings the theme.

- [ ] **Step 4: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/App.tsx
git commit -m "Add app shell with URL-driven view state"
```

---

### Task 8: Theme and responsive styling

**Files:**
- Modify: `frontend/src/theme.css` (replace the Task 1 minimal version entirely)

- [ ] **Step 1: Replace src/theme.css**

```css
:root {
  --bg: #14100c;
  --panel: #1f1912;
  --panel-border: #3d2f1f;
  --gold: #ff981f;
  --gold-light: #ffb84d;
  --text: #e8ded0;
  --text-dim: #a89c8a;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
}

.wrap {
  max-width: 780px;
  margin: 0 auto;
  padding: 0 20px;
}

.site-header {
  border-bottom: 3px solid var(--gold);
  padding: 28px 0 20px;
  background: linear-gradient(180deg, #221a10, var(--bg));
}

.site-header h1 { margin: 0; font-size: 2rem; letter-spacing: 0.5px; }
.accent { color: var(--gold); }
.subtitle { margin: 4px 0 0; color: var(--text-dim); }

main.wrap { padding-top: 24px; padding-bottom: 60px; }

.search-card, .boss-select-card {
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.search-card form { display: flex; gap: 10px; }

.search-card input {
  flex: 1;
  background: #100d09;
  border: 1px solid var(--panel-border);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 1rem;
}

button {
  background: var(--gold);
  color: #1a1208;
  border: none;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 6px;
  cursor: pointer;
}

button:hover { background: var(--gold-light); }

/* Visible keyboard focus everywhere - spec accessibility requirement */
:focus-visible {
  outline: 2px solid var(--gold);
  outline-offset: 2px;
}

input:focus { outline: none; border-color: var(--gold); }

.suggestions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }

.suggestions button {
  background: #100d09;
  color: var(--text);
  border: 1px solid var(--panel-border);
  font-weight: 400;
  padding: 4px 10px;
  font-size: 0.85rem;
}

.suggestions button:hover { border-color: var(--gold); color: var(--gold); }

.boss-select-card { display: flex; align-items: center; gap: 12px; }
.boss-select-card label { color: var(--text-dim); white-space: nowrap; }

.combobox { position: relative; flex: 1; min-width: 0; }

.combobox-trigger {
  width: 100%;
  background: #100d09;
  border: 1px solid var(--panel-border);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 1rem;
  font-family: inherit;
  font-weight: 400;
  text-align: left;
}

.combobox-trigger:hover { border-color: #5a4530; background: #100d09; }
.combobox-trigger .placeholder { color: var(--text-dim); }

.combobox-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: #100d09;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
  z-index: 20;
  overflow: hidden;
}

.combobox-filter {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--panel-border);
  color: var(--text);
  padding: 10px 12px;
  font-size: 0.92rem;
  font-family: inherit;
}

.combobox-options { max-height: 280px; overflow-y: auto; padding: 6px; }

.combobox-option {
  padding: 9px 12px;
  font-size: 0.9rem;
  cursor: pointer;
  border-radius: 5px;
}

.combobox-option.active { background: #241b10; color: var(--gold-light); }

.combobox-empty {
  padding: 14px 12px;
  color: var(--text-dim);
  font-size: 0.85rem;
  text-align: center;
}

.state {
  padding: 24px;
  text-align: center;
  color: var(--text-dim);
  background: var(--panel);
  border: 1px dashed var(--panel-border);
  border-radius: 8px;
}

.state-error { color: #e88; }

.match-list { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }

.match-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: #100d09;
  border: 1px solid var(--panel-border);
  color: var(--text);
  font-weight: 400;
  padding: 12px 14px;
  border-radius: 6px;
  text-align: left;
}

.match-option:hover { border-color: var(--gold); color: var(--gold-light); background: #100d09; }
.match-meta { color: var(--text-dim); font-size: 0.8rem; }

.result-title { font-size: 1.3rem; margin: 4px 0 12px; }
.result-meta { color: var(--text-dim); font-size: 0.85rem; margin-bottom: 14px; }

table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  overflow: hidden;
}

th, td {
  text-align: left;
  padding: 10px 14px;
  border-bottom: 1px solid var(--panel-border);
}

th {
  background: #241b10;
  color: var(--gold);
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

tr:last-child td { border-bottom: none; }
.rank { color: var(--text-dim); width: 32px; }
.time { font-weight: 600; color: var(--gold-light); }

.site-footer {
  border-top: 1px solid var(--panel-border);
  padding: 20px 0;
  color: var(--text-dim);
  font-size: 0.85rem;
}

/* Mobile: tables collapse to stacked label/value rows, per the spec */
@media (max-width: 560px) {
  .boss-select-card { flex-direction: column; align-items: stretch; }

  table, thead, tbody, tr, td { display: block; }
  thead { display: none; }

  tr {
    border-bottom: 1px solid var(--panel-border);
    padding: 8px 0;
  }

  td {
    border: none;
    padding: 4px 14px;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }

  td::before {
    content: attr(data-label);
    color: var(--text-dim);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .rank { width: auto; }
}
```

- [ ] **Step 2: Visual check**

Run: `cd frontend && npm run dev`, open the app. Expected: dark theme matching
the prototype's feel, gold accents, focus rings on Tab, tables collapse to
stacked rows below 560px (verify via devtools responsive mode).

- [ ] **Step 3: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/src/theme.css
git commit -m "Add dark OSRS theme with mobile stacked tables"
```

---

### Task 9: Playwright smoke tests (mocked API)

**Files:**
- Create: `frontend/playwright.config.ts`
- Create: `frontend/e2e/smoke.spec.ts`

Per the spec, these run against **mocked API responses via route
interception** — no live backend, no Neon dependency.

- [ ] **Step 1: Create playwright.config.ts**

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 2: Install the Playwright browser**

Run: `cd frontend && npx playwright install chromium`
Expected: Chromium downloads (one-time).

- [ ] **Step 3: Create e2e/smoke.spec.ts**

```typescript
import { test, expect } from '@playwright/test';

const player = {
  id: 1,
  displayName: 'Blitzen',
  updatedAt: '2026-07-04T18:00:00.000Z',
  pbs: [{ boss: 'zulrah', timeSeconds: 80, updatedAt: '2026-07-04T18:00:00.000Z' }],
};

const leaderboardRows = [
  { displayName: 'Fast', timeSeconds: 80, updatedAt: '2026-07-04T18:00:00.000Z' },
  { displayName: 'Slow', timeSeconds: 100, updatedAt: '2026-07-04T18:00:00.000Z' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/bosses', (r) => r.fulfill({ json: ['vorkath', 'zulrah'] }));
  await page.route('**/api/search**', (r) => r.fulfill({ json: ['Blitzen'] }));
});

test('initial load shows the search experience', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Player name')).toBeVisible();
  await expect(page.getByText('Search a player above')).toBeVisible();
});

test('player search success renders the PB table', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (r) => r.fulfill({ json: player }));
  await page.goto('/');
  await page.getByLabel('Player name').fill('Blitzen');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
  await expect(page.getByText('Zulrah')).toBeVisible();
  await expect(page.getByText('1:20')).toBeVisible();
});

test('unknown player shows the not-found state', async ({ page }) => {
  await page.route('**/api/players/Nobody', (r) =>
    r.fulfill({ status: 404, json: { error: 'Player not found' } })
  );
  await page.goto('/');
  await page.getByLabel('Player name').fill('Nobody');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText('No PB data found for')).toBeVisible();
});

test('ambiguous names show the picker and resolve by id', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (r) =>
    r.fulfill({
      json: {
        ambiguous: true,
        matches: [
          { id: 1, displayName: 'Blitzen', updatedAt: '2026-07-04T18:00:00.000Z' },
          { id: 2, displayName: 'Blitzen', updatedAt: '2026-07-03T18:00:00.000Z' },
        ],
      },
    })
  );
  await page.route('**/api/players/by-id/1', (r) => r.fulfill({ json: player }));
  await page.goto('/?player=Blitzen');
  await expect(page.getByText('Multiple synced players')).toBeVisible();
  await page.locator('.match-option').first().click();
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();
});

test('boss leaderboard loads via the combobox', async ({ page }) => {
  await page.route('**/api/leaderboard/zulrah**', (r) => r.fulfill({ json: leaderboardRows }));
  await page.goto('/');
  await page.getByRole('button', { name: /Select a boss/ }).click();
  await page.getByRole('option', { name: 'Zulrah' }).click();
  await expect(page.getByRole('heading', { name: /Zulrah — Top times/ })).toBeVisible();
  await expect(page.getByText('Fast')).toBeVisible();
});

test('shared URLs restore player and boss views', async ({ page }) => {
  await page.route('**/api/players/Blitzen', (r) => r.fulfill({ json: player }));
  await page.goto('/?player=Blitzen');
  await expect(page.getByRole('heading', { name: 'Blitzen' })).toBeVisible();

  await page.route('**/api/leaderboard/zulrah**', (r) => r.fulfill({ json: leaderboardRows }));
  await page.goto('/?boss=zulrah');
  await expect(page.getByRole('heading', { name: /Zulrah — Top times/ })).toBeVisible();
});
```

- [ ] **Step 4: Run the smoke suite**

Run: `cd frontend && npm run test:e2e`
Expected: 6/6 pass. (Playwright starts the dev server itself via `webServer`.)

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/playwright.config.ts frontend/e2e/smoke.spec.ts
git commit -m "Add Playwright smoke suite with mocked API routes"
```

---

### Task 10: Vercel deployment config + production build

**Files:**
- Create: `frontend/vercel.json`

- [ ] **Step 1: Create vercel.json**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

No SPA rewrite rules are needed: the app is a single route (`/`) using query
params, so there are no client-side paths that could 404 on refresh.

- [ ] **Step 2: Verify the production build**

Run: `cd frontend && npm run build && npm run preview`
Expected: `tsc --noEmit` clean, Vite build outputs to `dist/`, preview serves
the built app without console errors.

- [ ] **Step 3: Deploy — GATED, requires user confirmation**

Creating a new Vercel project is an external, user-visible action. **Confirm
with the user before running this step.** Once approved:

1. `cd frontend && vercel` — create/link a Vercel project rooted at
   `frontend/`.
2. In the Vercel dashboard (or `vercel env add`), set `VITE_API_BASE_URL` to
   `https://osrs-pb-tracker-backend.vercel.app` for Production and Preview.
3. `vercel --prod` — deploy.
4. Smoke-test the deployed URL: boss list populates, a known player lookup
   works.

- [ ] **Step 4: Commit**

```bash
cd "osrs-pb-tracker"
git add frontend/vercel.json
git commit -m "Add Vercel deployment config for frontend"
```

---

### Task 11: Manual verification (spec checklist)

**Files:** none (verification only)

Run through the spec's manual checklist:

- [ ] **Step 1:** Start the Hono backend locally (`cd backend-hono && npm run dev`).
- [ ] **Step 2:** Ensure at least one player with PBs exists (the dev Neon DB
  already has real synced data; otherwise use the curl smoke-test from the
  backend README).
- [ ] **Step 3:** Run the frontend locally against that backend
  (`VITE_API_BASE_URL=http://localhost:3000` in `frontend/.env`).
- [ ] **Step 4:** Search a known player — PB table renders with correct times.
- [ ] **Step 5:** Open a boss leaderboard via the combobox — keyboard-only
  operation works (Tab to trigger, Enter to open, arrows + Enter to select).
- [ ] **Step 6:** Open direct URLs `/?player=<name>` and `/?boss=<boss>` —
  views restore; with both params present, player wins.
- [ ] **Step 7:** `npm run build && npm run preview` — production output
  behaves identically.
- [ ] **Step 8:** Narrow the window below 560px — tables switch to stacked
  rows and remain readable.

No commit — record any failures as fix tasks instead of proceeding.
