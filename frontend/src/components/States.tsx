import type { ReactNode } from 'react';

export function Loading() {
  return <div className="state">Loading...</div>;
}

export function ErrorState() {
  return <div className="state state-error">Couldn't load data - try again shortly.</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="state">{children}</div>;
}
