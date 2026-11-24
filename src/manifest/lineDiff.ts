export type JsonDiffLineKind = 'context' | 'added' | 'removed';

export interface JsonDiffLine {
  kind: JsonDiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface JsonLineDiff {
  lines: JsonDiffLine[];
  added: number;
  removed: number;
}

export interface JsonDiffSegment {
  type: 'visible' | 'collapsed';
  /** Inclusive start and exclusive end line offsets in the full diff. */
  start: number;
  end: number;
  /** JSON scope for a hunk whose leading context does not show its parents. */
  scope?: string[];
}

type Edit =
  | { type: 'equal'; value: string }
  | { type: 'insert'; value: string }
  | { type: 'delete'; value: string };

const MAX_MYERS_DISTANCE = 512;
const MAX_MYERS_WORK = 400_000;
const MAX_LCS_CELLS = 250_000;

function prettyLines(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  const json = JSON.stringify(value, null, 2);
  return json === undefined ? [] : json.split('\n');
}

function commonPrefixLength(left: string[], right: string[]): number {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string[], right: string[], prefix: number): number {
  let count = 0;
  while (
    count < left.length - prefix &&
    count < right.length - prefix &&
    left[left.length - count - 1] === right[right.length - count - 1]
  ) {
    count += 1;
  }
  return count;
}

function lcsEdits(left: string[], right: string[]): Edit[] {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = Array.from({ length: rows }, () => new Uint32Array(columns));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    const row = table[i];
    const nextRow = table[i + 1];
    if (!row || !nextRow) continue;
    for (let j = right.length - 1; j >= 0; j -= 1) {
      row[j] =
        left[i] === right[j]
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      edits.push({ type: 'equal', value: left[i]! });
      i += 1;
      j += 1;
    } else if (
      j < right.length &&
      (i >= left.length ||
        (table[i]?.[j + 1] ?? 0) > (table[i + 1]?.[j] ?? 0))
    ) {
      edits.push({ type: 'insert', value: right[j]! });
      j += 1;
    } else {
      edits.push({ type: 'delete', value: left[i]! });
      i += 1;
    }
  }
  return edits;
}

function myersEdits(left: string[], right: string[]): Edit[] | null {
  const max = left.length + right.length;
  if (max === 0) return [];
  const offset = max + 1;
  let frontier = new Int32Array(max * 2 + 3);
  frontier.fill(-1);
  frontier[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let work = 0;
  let endDistance = -1;

  for (let distance = 0; distance <= Math.min(max, MAX_MYERS_DISTANCE); distance += 1) {
    const next = frontier.slice();
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      work += 1;
      if (work > MAX_MYERS_WORK) return null;

      const index = offset + diagonal;
      const down =
        diagonal === -distance ||
        (diagonal !== distance &&
          (frontier[index - 1] ?? -1) < (frontier[index + 1] ?? -1));
      let x = down ? (frontier[index + 1] ?? 0) : (frontier[index - 1] ?? 0) + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x += 1;
        y += 1;
        work += 1;
        if (work > MAX_MYERS_WORK) return null;
      }
      next[index] = x;
      if (x >= left.length && y >= right.length) {
        trace.push(next);
        endDistance = distance;
        break;
      }
    }
    if (endDistance >= 0) break;
    trace.push(next);
    frontier = next;
  }

  if (endDistance < 0) return null;

  const reverse: Edit[] = [];
  let x = left.length;
  let y = right.length;
  for (let distance = endDistance; distance > 0; distance -= 1) {
    const previous = trace[distance - 1];
    if (!previous) return null;
    const diagonal = x - y;
    const index = offset + diagonal;
    const previousDiagonal =
      diagonal === -distance ||
      (diagonal !== distance &&
        (previous[index - 1] ?? -1) < (previous[index + 1] ?? -1))
        ? diagonal + 1
        : diagonal - 1;
    const previousX = previous[offset + previousDiagonal] ?? 0;
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      reverse.push({ type: 'equal', value: left[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (x === previousX) {
      reverse.push({ type: 'insert', value: right[y - 1]! });
      y -= 1;
    } else {
      reverse.push({ type: 'delete', value: left[x - 1]! });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    reverse.push({ type: 'equal', value: left[x - 1]! });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    reverse.push({ type: 'delete', value: left[--x]! });
  }
  while (y > 0) {
    reverse.push({ type: 'insert', value: right[--y]! });
  }
  return reverse.reverse();
}

function fallbackEdits(left: string[], right: string[]): Edit[] {
  const edits: Edit[] = [];
  left.forEach((value) => edits.push({ type: 'delete', value }));
  right.forEach((value) => edits.push({ type: 'insert', value }));
  return edits;
}

function diffEdits(left: string[], right: string[]): Edit[] {
  const prefix = commonPrefixLength(left, right);
  const suffix = commonSuffixLength(left, right, prefix);
  const middleLeft = left.slice(prefix, left.length - suffix);
  const middleRight = right.slice(prefix, right.length - suffix);
  const middle =
    middleLeft.length * middleRight.length <= MAX_LCS_CELLS
      ? lcsEdits(middleLeft, middleRight)
      : myersEdits(middleLeft, middleRight) ?? fallbackEdits(middleLeft, middleRight);

  return [
    ...left.slice(0, prefix).map((value): Edit => ({ type: 'equal', value })),
    ...middle,
    ...(suffix > 0
      ? left.slice(left.length - suffix).map((value): Edit => ({ type: 'equal', value }))
      : []),
  ];
}

/**
 * Pretty-print and compare two JSON values as lines. Null/undefined are treated
 * as an absent snapshot (zero lines), which makes an Added revision read as
 * additions rather than as a synthetic `null` value.
 */
export function createJsonLineDiff(
  before: unknown,
  after: unknown,
): JsonLineDiff {
  const beforeLines = prettyLines(before);
  const afterLines = prettyLines(after);
  const edits = diffEdits(beforeLines, afterLines);
  const lines: JsonDiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let added = 0;
  let removed = 0;

  for (const edit of edits) {
    if (edit.type === 'equal') {
      lines.push({ kind: 'context', text: edit.value, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else if (edit.type === 'delete') {
      lines.push({ kind: 'removed', text: edit.value, oldLine, newLine: null });
      oldLine += 1;
      removed += 1;
    } else {
      lines.push({ kind: 'added', text: edit.value, oldLine: null, newLine });
      newLine += 1;
      added += 1;
    }
  }
  return { lines, added, removed };
}

/**
 * Group unchanged lines into visible change hunks and collapsed gaps. Each
 * change keeps `context` lines on either side; callers may reveal extra line
 * offsets incrementally or expand the entire diff.
 */
export function groupJsonDiffLines(
  lines: readonly JsonDiffLine[],
  context = 3,
  expandedLines: ReadonlySet<number> = new Set(),
  expandAll = false,
): JsonDiffSegment[] {
  const visible = new Uint8Array(lines.length);
  if (expandAll) {
    visible.fill(1);
  } else {
    lines.forEach((line, index) => {
      if (line.kind !== 'context') {
        const start = Math.max(0, index - context);
        const end = Math.min(lines.length - 1, index + context);
        for (let cursor = start; cursor <= end; cursor += 1) {
          visible[cursor] = 1;
        }
      }
    });
    expandedLines.forEach((index) => {
      if (index >= 0 && index < lines.length) visible[index] = 1;
    });
  }

  const segments: JsonDiffSegment[] = [];
  const oldLines = lines
    .filter((line) => line.oldLine !== null)
    .map((line) => line.text);
  const newLines = lines
    .filter((line) => line.newLine !== null)
    .map((line) => line.text);

  const scopeAtLine = (source: readonly string[], targetLine: number): string[] => {
    interface ScopeFrame {
      label: string;
      kind: 'object' | 'array';
      indent: number;
      childIndex: number;
    }
    const stack: ScopeFrame[] = [];
    const indentOf = (text: string): number => text.length - text.trimStart().length;
    const keyPattern = /^"((?:\\.|[^"\\])*)"\s*:\s*(.*)$/;
    const walkEnd = Math.min(targetLine - 1, source.length);

    for (let index = 0; index < walkEnd; index += 1) {
      const text = source[index] ?? '';
      const trimmed = text.trimStart();
      const indent = indentOf(text);
      const closesContainer = /^[}\]]/.test(trimmed);
      if (closesContainer) {
        while (stack.length > 0 && stack.at(-1)!.indent >= indent) stack.pop();
      }

      const parent = stack.at(-1);
      if (
        !closesContainer &&
        parent?.kind === 'array' &&
        indent === parent.indent + 2 &&
        trimmed.length > 0
      ) {
        parent.childIndex += 1;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          stack.push({
            label: `${parent.label}[${parent.childIndex - 1}]`,
            kind: trimmed.startsWith('[') ? 'array' : 'object',
            indent,
            childIndex: 0,
          });
          continue;
        }
      }

      const property = trimmed.match(keyPattern);
      if (!property) continue;
      const value = property[2]?.trimStart() ?? '';
      if (value.startsWith('{') || value.startsWith('[')) {
        stack.push({
          label: property[1] ?? '',
          kind: value.startsWith('[') ? 'array' : 'object',
          indent,
          childIndex: 0,
        });
      }
    }

    const targetText = source[targetLine - 1] ?? '';
    const targetIndent = indentOf(targetText);
    const parent = stack.at(-1);
    const targetIsArrayChild =
      parent?.kind === 'array' && targetIndent === parent.indent + 2;
    const labels = stack
      .filter((frame, index) => {
        if (targetIsArrayChild && frame === parent) return false;
        return (
          frame.kind !== 'array' ||
          !stack[index + 1]?.label.startsWith(`${frame.label}[`)
        );
      })
      .map((frame) => frame.label)
      .filter(Boolean);
    if (targetIsArrayChild && parent) {
      return [...labels, `${parent.label}[${parent.childIndex}]`].filter(Boolean);
    }
    return labels;
  };

  let start = 0;
  while (start < lines.length) {
    const isVisible = visible[start] === 1;
    let end = start + 1;
    while (end < lines.length && (visible[end] === 1) === isVisible) {
      end += 1;
    }
    const segment: JsonDiffSegment = { type: isVisible ? 'visible' : 'collapsed', start, end };
    if (isVisible) {
      let changedIndex = start;
      while (changedIndex < end && lines[changedIndex]?.kind === 'context') changedIndex += 1;
      const changed = lines[changedIndex];
      if (changed) {
        const scope =
          changed.kind === 'removed' && changed.oldLine !== null
            ? scopeAtLine(oldLines, changed.oldLine)
            : changed.newLine !== null
              ? scopeAtLine(newLines, changed.newLine)
              : [];
        const leadingContext = lines
          .slice(start, changedIndex)
          .map((line) => line.text)
          .join('\n');
        const everyScopeKeyIsVisible = scope.every((part) => {
          const key = part.replace(/\[\d+\]$/, '');
          return key.length === 0 || leadingContext.includes(`"${key}"`);
        });
        if (scope.length > 0 && !everyScopeKeyIsVisible) segment.scope = scope;
      }
    }
    segments.push(segment);
    start = end;
  }
  return segments;
}
