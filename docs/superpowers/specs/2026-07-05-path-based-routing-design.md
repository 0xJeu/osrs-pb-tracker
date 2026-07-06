# Path-Based Routing — Design

## Goal

Replace the query-string-driven view state (`/?player=`, `/?boss=`, `/?page=faq`)
with real, shareable paths (`/player/:name`, `/boss/:name`, `/faq`), since the
current shape was a byproduct of the initial rebuild avoiding a Vercel
rewrite rule, not an intentional URL design.

## Background

Query strings on `/` work on static hosting with zero extra config, which is
why the frontend rebuild used them. Real paths need one additional piece of
platform config - a catch-all rewrite so any unknown path still serves
`index.html` and the client router can take over - otherwise a refresh or a
shared link to `/player/Autisrick` 404s outright, since no such file exists
in the static output.

## Scope

**In scope:** switching `App.tsx`'s view routing from query-string parsing to
pathname parsing, the matching `vercel.json` rewrite rule, and updating the
existing Playwright smoke suite that currently asserts the old query-string
URLs.

**Out of scope:**
- Any redirect/compatibility shim for the old `?player=`/`?boss=`/`?page=faq`
  links. The site has no meaningful existing traffic to those URLs yet, so
  they're dropped outright rather than kept working alongside the new paths.
- Adopting a router library (react-router or similar). The app has four flat
  routes with no nesting, layouts, or data loaders - the existing hand-rolled
  `viewFromLocation`/`navigate` pair in `App.tsx` covers that with the same
  amount of code it already has, just parsing `pathname` instead of `search`.
- A dedicated 404 view. Unmatched paths fall back to the home view, same as
  today's behavior for an unrecognized query string.

## Design

**URL shapes:**
```
/                    -> home
/player/<name>       -> player view (e.g. /player/Autisrick)
/boss/<name>         -> boss view (e.g. /boss/Zulrah)
/faq                 -> faq view
```

**`vercel.json` (both the repo-root copy and `frontend/vercel.json` - the
project's actual root directory isn't visible from the filesystem, so both
get the rewrite for safety):**
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**`App.tsx` changes:**

`viewFromLocation()` parses `window.location.pathname` instead of
`window.location.search`:

```ts
function viewFromLocation(): View {
  const path = window.location.pathname;
  const playerMatch = path.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = path.match(/^\/boss\/(.+)$/);
  if (bossMatch) return { name: 'boss', boss: decodeURIComponent(bossMatch[1]) };
  if (path === '/faq') return { name: 'faq' };
  return { name: 'home' };
}
```

`navigate()` builds a real pathname instead of mutating `url.search`:

```ts
const navigate = (next: View) => {
  const path =
    next.name === 'player' ? `/player/${encodeURIComponent(next.player)}`
    : next.name === 'boss' ? `/boss/${encodeURIComponent(next.boss)}`
    : next.name === 'faq' ? '/faq'
    : '/';
  window.history.pushState({}, '', path);
  setView(next);
};
```

`encodeURIComponent` matters here specifically because boss names contain
spaces, apostrophes, and parentheses (e.g. `tzhaar-ket-rak's fourth
challenge`, `chambers of xeric - challenge mode - fastest overall (2
players)`).

**Link hrefs:** the three places that build a manual `href` alongside the
`onClick`-driven `navigate()` call (the logo, the footer FAQ link, and the
"Times look wrong? See our FAQ" nudge in `PlayerResult.tsx`) switch from
`/?page=faq` to `/faq`. No other component builds URLs directly -
`SearchBar`, `BossCombobox`, and `RecentSyncs` all just invoke the
`navigate`/`onSubmit`/`onSelect` callbacks passed down from `App.tsx`, so
they need no changes.

## Testing

`e2e/smoke.spec.ts` currently asserts the old query-string shape in two
places and needs updating to match:

- `'recent sync rows navigate to player results'`: assertion changes from
  `expect(page).toHaveURL(/player=Blitzen/)` to
  `expect(page).toHaveURL(/\/player\/Blitzen/)`.
- `'shared URLs restore player and boss views'`: `page.goto('/?player=Blitzen')`
  becomes `page.goto('/player/Blitzen')`, and `page.goto('/?boss=zulrah')`
  becomes `page.goto('/boss/zulrah')`.

No other tests reference view routing (`api.test.ts`/`dedupe.test.ts`/
`format.test.ts` are all pure-function unit tests unrelated to this). Full
Playwright suite run after the change to confirm nothing else regresses.
