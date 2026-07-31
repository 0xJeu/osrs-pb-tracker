export type LoadState<T> = { s: 'idle' } | { s: 'loading' } | { s: 'error' } | { s: 'loaded'; data: T };

export function isLoaded<T>(state: LoadState<T>): state is { s: 'loaded'; data: T } {
  return state.s === 'loaded';
}
