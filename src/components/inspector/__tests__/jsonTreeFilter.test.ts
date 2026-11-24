import { describe, expect, it } from 'vitest';
import {
  selectFilteredChildren,
  type FilterChildCandidate,
} from '../jsonTreeFilter';

function makeEntries(
  count: number,
  directIndexes: number[] = [],
  ancestorIndexes: number[] = [],
): FilterChildCandidate<number>[] {
  return Array.from({ length: count }, (_, index) => ({
    key: String(index),
    path: `parent[${index}]`,
    value: index,
    isDirectMatch: directIndexes.includes(index),
    isAncestorPath: ancestorIndexes.includes(index),
  }));
}

describe('selectFilteredChildren', () => {
  it('shows every sibling in a small non-root container with a direct match', () => {
    const entries: FilterChildCandidate<unknown>[] = [
      {
        key: 'statTypeHash',
        path: 'investmentStats[1].statTypeHash',
        value: 3555269338,
        isDirectMatch: true,
        isAncestorPath: false,
      },
      {
        key: 'value',
        path: 'investmentStats[1].value',
        value: 4,
        isDirectMatch: false,
        isAncestorPath: false,
      },
      {
        key: 'isConditionallyActive',
        path: 'investmentStats[1].isConditionallyActive',
        value: false,
        isDirectMatch: false,
        isAncestorPath: false,
      },
    ];

    const result = selectFilteredChildren(entries, entries.length, false);

    expect(result).toHaveLength(3);
    expect(result).toMatchObject([
      { type: 'child', entry: { key: 'statTypeHash' }, isContextSibling: false },
      { type: 'child', entry: { key: 'value', value: 4 }, isContextSibling: true },
      {
        type: 'child',
        entry: { key: 'isConditionallyActive', value: false },
        isContextSibling: true,
      },
    ]);
    expect(result.some((segment) => segment.type === 'omitted')).toBe(false);
  });

  it('keeps ancestor-only containers filtered to their matching path', () => {
    const result = selectFilteredChildren(makeEntries(4, [], [1]), 4, false);

    expect(
      result
        .filter((segment) => segment.type === 'child')
        .map((segment) => segment.entry.key),
    ).toEqual(['1']);
    expect(result).toEqual([
      {
        type: 'child',
        entry: expect.objectContaining({ key: '1', path: 'parent[1]' }),
        isContextSibling: false,
      },
    ]);
  });

  it('bounds context in large non-root containers and records ordered omitted gaps', () => {
    const result = selectFilteredChildren(
      makeEntries(45, [4, 12, 20, 28, 36]),
      45,
      false,
    );
    const children = result.filter((segment) => segment.type === 'child');
    const context = children.filter(
      (segment) => segment.type === 'child' && segment.isContextSibling,
    );
    const gaps = result.filter((segment) => segment.type === 'omitted');

    expect(context).toHaveLength(12);
    expect(
      children
        .filter((segment) => segment.type === 'child')
        .map((segment) => Number(segment.entry.key)),
    ).toEqual([2, 3, 4, 5, 6, 11, 12, 13, 19, 20, 21, 27, 28, 29, 35, 36, 37]);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((segment) => segment.type === 'omitted' && segment.hiddenCount > 0)).toBe(
      true,
    );
    expect(gaps.map((segment) => segment.hiddenCount).reduce((sum, n) => sum + n, 0)).toBe(28);
    expect(gaps.map((segment) => segment.jumpPath)).toEqual([
      'parent[4]',
      'parent[12]',
      'parent[12]',
      'parent[20]',
      'parent[28]',
      'parent[36]',
    ]);
  });

  it('uses the smaller root context cap and points gaps at the nearest direct match', () => {
    const result = selectFilteredChildren(makeEntries(20, [5, 15]), 20, true);
    const children = result.filter((segment) => segment.type === 'child');
    const context = children.filter(
      (segment) => segment.type === 'child' && segment.isContextSibling,
    );
    const gaps = result.filter((segment) => segment.type === 'omitted');

    expect(context).toHaveLength(6);
    expect(
      children
        .filter((segment) => segment.type === 'child')
        .map((segment) => Number(segment.entry.key)),
    ).toEqual([3, 4, 5, 6, 7, 14, 15, 16]);
    expect(gaps.map((segment) => segment.hiddenCount)).toEqual([3, 6, 3]);
    expect(gaps.map((segment) => segment.jumpPath)).toEqual([
      'parent[5]',
      'parent[15]',
      'parent[15]',
    ]);
  });
});
