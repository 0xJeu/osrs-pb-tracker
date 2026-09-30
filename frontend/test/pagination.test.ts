import { describe, expect, it } from 'vitest';
import { paginationItems } from '../src/components/BossView';

describe('paginationItems', () => {
  it('shows every page for short leaderboards', () => {
    expect(paginationItems(2, 3)).toEqual([1, 2, 3]);
  });

  it('keeps the current page centered within a long leaderboard', () => {
    expect(paginationItems(6, 12)).toEqual([1, 'ellipsis-start', 5, 6, 7, 'ellipsis-end', 12]);
  });

  it('expands the beginning and end without redundant ellipses', () => {
    expect(paginationItems(2, 12)).toEqual([1, 2, 3, 4, 5, 'ellipsis-end', 12]);
    expect(paginationItems(11, 12)).toEqual([1, 'ellipsis-start', 8, 9, 10, 11, 12]);
  });
});
