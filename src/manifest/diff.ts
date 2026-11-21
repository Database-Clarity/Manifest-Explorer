export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  /** Dot/bracket path relative to the comparison root, e.g. sockets.socketEntries[0].plugSources */
  path: string;
  kind: DiffKind;
  left?: unknown;
  right?: unknown;
}

const MAX_DIFF_ENTRIES = 5000;
const MAX_DEPTH = 64;
const MAX_VISITED_NODES = 200_000;

interface DiffState {
  entries: DiffEntry[];
  visited: number;
  stopped: boolean;
  /** Guard against (unlikely) cyclic manifest objects without throwing. */
  seen: WeakMap<object, WeakSet<object>>;
}

function rootPath(basePath: string): string {
  return basePath || '$';
}

function childPath(basePath: string, key: string): string {
  return basePath ? `${basePath}.${key}` : key;
}

function arrayPath(basePath: string, index: number): string {
  return `${basePath}[${index}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function markSeen(state: DiffState, left: object, right: object): boolean {
  const leftSeen = state.seen.get(left);
  if (leftSeen?.has(right)) return true;
  if (leftSeen) {
    leftSeen.add(right);
  } else {
    state.seen.set(left, new WeakSet<object>([right]));
  }
  return false;
}

function addEntry(state: DiffState, entry: DiffEntry): void {
  if (state.entries.length >= MAX_DIFF_ENTRIES) {
    state.stopped = true;
    return;
  }
  state.entries.push(entry);
}

function walk(
  state: DiffState,
  left: unknown,
  right: unknown,
  path: string,
  depth: number,
): void {
  if (state.stopped) return;
  if (state.entries.length >= MAX_DIFF_ENTRIES) {
    state.stopped = true;
    return;
  }

  state.visited += 1;
  if (state.visited > MAX_VISITED_NODES) {
    state.stopped = true;
    return;
  }

  if (Object.is(left, right)) return;

  if (depth > MAX_DEPTH) {
    addEntry(state, { path: path || rootPath(path), kind: 'changed', left, right });
    return;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      addEntry(state, { path: path || rootPath(path), kind: 'changed', left, right });
      return;
    }

    if (markSeen(state, left, right)) return;

    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      if (state.stopped) return;
      const leftIndex = index < left.length;
      const rightIndex = index < right.length;
      const entryPath = arrayPath(path, index);

      if (leftIndex && rightIndex) {
        walk(state, left[index], right[index], entryPath, depth + 1);
      } else if (rightIndex) {
        addEntry(state, { path: entryPath, kind: 'added', right: right[index] });
      } else {
        addEntry(state, { path: entryPath, kind: 'removed', left: left[index] });
      }
    }
    return;
  }

  if (isRecord(left) && isRecord(right)) {
    if (markSeen(state, left, right)) return;

    const keys = new Set<string>([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (state.stopped) return;
      const hasLeft = Object.prototype.hasOwnProperty.call(left, key);
      const hasRight = Object.prototype.hasOwnProperty.call(right, key);
      const entryPath = childPath(path, key);

      if (hasLeft && hasRight) {
        walk(state, left[key], right[key], entryPath, depth + 1);
      } else if (hasRight) {
        addEntry(state, { path: entryPath, kind: 'added', right: right[key] });
      } else {
        addEntry(state, { path: entryPath, kind: 'removed', left: left[key] });
      }
    }
    return;
  }

  // Primitives, null/undefined transitions, functions and type changes.
  addEntry(state, { path: path || rootPath(path), kind: 'changed', left, right });
}

/**
 * Compute a structural JSON diff. Arrays are compared by index, objects by key.
 * Comparison is capped in depth and node count so two enormous vendor
 * definitions can be compared without freezing the UI.
 */
export function computeJsonDiff(left: unknown, right: unknown, basePath = ''): DiffEntry[] {
  const state: DiffState = {
    entries: [],
    visited: 0,
    stopped: false,
    seen: new WeakMap<object, WeakSet<object>>(),
  };

  walk(state, left, right, basePath, 0);
  return state.entries;
}
