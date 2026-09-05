import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SearchSuggestion } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { titleCase } from '../lib/format';
import { bossSearchAlias } from '../lib/bossAliases';
import { getRaidModes } from '../lib/bossGroups';

export function compactAliasSuggestions(query: string, bosses: string[]): SearchSuggestion[] | undefined {
  const alias = bossSearchAlias(query);
  if (!alias) return undefined;
  const modes = getRaidModes(bosses, alias.base)
    .filter((mode) => !alias.modeLabel || mode.modeLabel === alias.modeLabel);
  if (modes.length === 0) {
    const normalizedTarget = alias.target.trim().toLowerCase();
    const matches = bosses
      .filter((boss) => {
        const normalizedBoss = boss.trim().toLowerCase();
        return normalizedBoss === normalizedTarget || normalizedBoss.startsWith(`${normalizedTarget} -`);
      })
      .sort((a, b) => {
        const aExact = a.trim().toLowerCase() === normalizedTarget;
        const bExact = b.trim().toLowerCase() === normalizedTarget;
        return Number(bExact) - Number(aExact) || a.localeCompare(b);
      });
    return matches.length > 0
      ? matches.map((boss) => ({ type: 'boss' as const, value: boss, label: titleCase(boss) }))
      : undefined;
  }
  const raidLabel = titleCase(alias.base);
  return modes.map((mode) => ({
    type: 'boss',
    value: mode.variants[0].key,
    label: `${raidLabel} — ${mode.modeLabel}`,
  }));
}

export function useSearchSuggestions(query: string, bosses: LoadState<string[]>): SearchSuggestion[] {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setSuggestions([]); return; }
    const alias = bossSearchAlias(trimmed);
    if (alias) {
      const compactSuggestions = isLoaded(bosses) ? compactAliasSuggestions(trimmed, bosses.data) : undefined;
      // A recognized boss alias is reserved for boss navigation. Do not let
      // universal player results appear while boss metadata is unavailable,
      // or when this deployment does not yet expose a matching boss record.
      setSuggestions(compactSuggestions ?? []);
      return;
    }
    let alive = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api.searchAll(trimmed, { signal: controller.signal })
        .then((result) => { if (alive) setSuggestions(result); })
        .catch(() => { if (alive) setSuggestions([]); });
    }, 275);
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, bosses]);

  return suggestions;
}
