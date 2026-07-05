// Raids report multiple records under a shared base name (e.g. "Theatre of
// Blood", "Theatre of Blood - Fastest Room (4 player)"). The bare base entry
// is ambiguous once a more specific variant exists, so we hide it rather than
// show a number that might be misleading. Ported from website/app.js.
export function hideAmbiguousBaseEntries<T>(items: T[], getName: (item: T) => string): T[] {
  const names = items.map((item) => getName(item).toLowerCase());
  return items.filter((item) => {
    const lower = getName(item).toLowerCase();
    const hasMoreSpecificVariant = names.some((n) => n !== lower && n.startsWith(`${lower} `));
    return !hasMoreSpecificVariant;
  });
}
