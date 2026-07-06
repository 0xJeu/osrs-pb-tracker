// The backend stores every synced PB key verbatim. Earlier builds hid base raid
// names when variants existed, but that dropped real regular-mode records from
// both player tables and boss search. Preserve all entries for accuracy.
export function hideAmbiguousBaseEntries<T>(items: T[], getName: (item: T) => string): T[] {
  return items;
}
