export interface FilterChildCandidate<T> {
  key: string;
  path: string;
  value: T;
  isDirectMatch: boolean;
  isAncestorPath: boolean;
}

export type FilteredChildSegment<T> =
  | {
      type: 'child';
      entry: FilterChildCandidate<T>;
      isContextSibling: boolean;
    }
  | {
      type: 'omitted';
      hiddenCount: number;
      jumpPath: string;
    };

const SMALL_CONTAINER_LIMIT = 12;
const ROOT_CONTEXT_LIMIT = 6;
const CONTAINER_CONTEXT_LIMIT = 12;
const SIBLING_WINDOW = 2;

/**
 * Selects the visible children for Filter mode, preserving hidden runs as
 * jumpable gaps. Entries should already be restricted to the active diff view.
 */
export function selectFilteredChildren<T>(
  entries: readonly FilterChildCandidate<T>[],
  count: number,
  isRoot: boolean,
): FilteredChildSegment<T>[] {
  const candidates = entries.slice(0, Math.max(0, count));
  const directMatchIndexes = candidates.flatMap((entry, index) =>
    entry.isDirectMatch ? [index] : [],
  );
  const directMatchIndexSet = new Set(directMatchIndexes);

  if (directMatchIndexes.length === 0) {
    return candidates.flatMap((entry) =>
      entry.isAncestorPath
        ? [{ type: 'child' as const, entry, isContextSibling: false }]
        : [],
    );
  }

  const alwaysVisible = new Set<number>();
  const contextIndexes = new Set<number>();
  candidates.forEach((entry, index) => {
    if (entry.isDirectMatch || entry.isAncestorPath) {
      alwaysVisible.add(index);
    }
  });

  const contextLimit =
    !isRoot && count <= SMALL_CONTAINER_LIMIT
      ? Number.POSITIVE_INFINITY
      : isRoot
        ? ROOT_CONTEXT_LIMIT
        : CONTAINER_CONTEXT_LIMIT;

  if (contextLimit === Number.POSITIVE_INFINITY) {
    candidates.forEach((_, index) => {
      if (!alwaysVisible.has(index)) contextIndexes.add(index);
    });
  } else {
    const nearbyIndexes = candidates.flatMap((_, index) => {
      if (alwaysVisible.has(index)) return [];
      let distance = Number.POSITIVE_INFINITY;
      for (let offset = -SIBLING_WINDOW; offset <= SIBLING_WINDOW; offset += 1) {
        if (directMatchIndexSet.has(index + offset)) {
          distance = Math.min(distance, Math.abs(offset));
        }
      }
      return distance <= SIBLING_WINDOW ? [{ index, distance }] : [];
    });
    nearbyIndexes
      .sort((left, right) => left.distance - right.distance || left.index - right.index)
      .slice(0, contextLimit)
      .forEach(({ index }) => contextIndexes.add(index));
  }

  const visibleIndexes = new Set([...alwaysVisible, ...contextIndexes]);
  const nearestMatchPath = (index: number): string => {
    let low = 0;
    let high = directMatchIndexes.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((directMatchIndexes[middle] ?? Number.POSITIVE_INFINITY) < index) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const before = directMatchIndexes[low - 1];
    const after = directMatchIndexes[low];
    const nearestIndex =
      before === undefined
        ? (after ?? 0)
        : after === undefined ||
            index - before <= after - index
          ? before
          : after;
    return candidates[nearestIndex]?.path ?? candidates[directMatchIndexes[0] ?? 0]?.path ?? '';
  };

  const segments: FilteredChildSegment<T>[] = [];
  for (let index = 0; index < candidates.length; ) {
    if (visibleIndexes.has(index)) {
      const entry = candidates[index];
      if (entry) {
        segments.push({
          type: 'child',
          entry,
          isContextSibling: contextIndexes.has(index),
        });
      }
      index += 1;
      continue;
    }

    const gapStart = index;
    while (index < candidates.length && !visibleIndexes.has(index)) index += 1;
    segments.push({
      type: 'omitted',
      hiddenCount: index - gapStart,
      jumpPath: nearestMatchPath((gapStart + index - 1) / 2),
    });
  }
  return segments;
}
