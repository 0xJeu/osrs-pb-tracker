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
  if (modes.length === 0) return undefined;
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
    const compactSuggestions = isLoaded(bosses) ? compactAliasSuggestions(trimmed, bosses.data) : undefined;
    if (compactSuggestions) {
      setSuggestions(compactSuggestions);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      api.searchAll(trimmed).then((result) => { if (alive) setSuggestions(result); }).catch(() => { if (alive) setSuggestions([]); });
    }, 275);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, bosses]);

  return suggestions;
}
