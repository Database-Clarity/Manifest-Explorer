export type JsonDiffLineKind = 'context' | 'added' | 'removed';

export interface JsonDiffLine {
  kind: JsonDiffLineKind;
  text: string;
  /** Original before-side text when structural punctuation differs. */
  beforeText?: string;
  oldLine: number | null;
  newLine: number | null;
  /** Character offsets in `text` to emphasize for a small inline edit. */
  inlineSpans?: ReadonlyArray<InlineDiffSpan>;
}

export interface InlineDiffSpan {
  start: number;
  end: number;
}

export interface InlineDiffSpans {
  before: ReadonlyArray<InlineDiffSpan>;
  after: ReadonlyArray<InlineDiffSpan>;
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
  | { type: 'equal'; value: string; beforeValue?: string }
  | { type: 'insert'; value: string }
  | { type: 'delete'; value: string };

const MAX_MYERS_DISTANCE = 512;
const MAX_MYERS_WORK = 400_000;
const MAX_LCS_CELLS = 250_000;
const MAX_INLINE_LCS_CELLS = 20_000;

function prettyLines(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  const json = JSON.stringify(value, null, 2);
  return json === undefined ? [] : json.split('\n');
}

function normalizedLineKey(line: string): string {
  return line.replace(/,\s*$/, '');
}

function equalLineEdit(before: string, after: string): Edit {
  return {
    type: 'equal',
    value: after,
    ...(before === after ? {} : { beforeValue: before }),
  };
}

function commonPrefixLength(left: string[], right: string[]): number {
  let index = 0;
  while (
    index < left.length &&
    index < right.length &&
    normalizedLineKey(left[index]!) === normalizedLineKey(right[index]!)
  ) {
    index += 1;
  }
  return index;
}

function commonSuffixLength(left: string[], right: string[], prefix: number): number {
  let count = 0;
  while (
    count < left.length - prefix &&
    count < right.length - prefix &&
    normalizedLineKey(left[left.length - count - 1]!) ===
      normalizedLineKey(right[right.length - count - 1]!)
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
        normalizedLineKey(left[i]!) === normalizedLineKey(right[j]!)
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }

  const edits: Edit[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (
      i < left.length &&
      j < right.length &&
      normalizedLineKey(left[i]!) === normalizedLineKey(right[j]!)
    ) {
      edits.push(equalLineEdit(left[i]!, right[j]!));
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
      while (
        x < left.length &&
        y < right.length &&
        normalizedLineKey(left[x]!) === normalizedLineKey(right[y]!)
      ) {
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
      reverse.push(equalLineEdit(left[x - 1]!, right[y - 1]!));
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
    reverse.push(equalLineEdit(left[x - 1]!, right[y - 1]!));
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
    ...left
      .slice(0, prefix)
      .map((value, index): Edit => equalLineEdit(value, right[index]!)),
    ...middle,
    ...(suffix > 0
      ? left
          .slice(left.length - suffix)
          .map((value, index): Edit =>
            equalLineEdit(value, right[right.length - suffix + index]!),
          )
      : []),
  ];
}

interface JsonValueRegion {
  prefix: string;
  token: string;
  start: number;
  contentStart: number;
  contentEnd: number;
  isString: boolean;
  indent: string;
  isProperty: boolean;
}

const PROPERTY_VALUE_PREFIX = /^(\s*"(?:\\.|[^"\\])*"\s*:\s*)(.*)$/;
const STRUCTURAL_VALUE = /^(?:[{}\[\]],?)$/;

function jsonValueRegion(line: string): JsonValueRegion | null {
  const property = line.match(PROPERTY_VALUE_PREFIX);
  const prefix = property?.[1] ?? '';
  const value = property?.[2] ?? line.slice(line.length - line.trimStart().length);
  const start = property
    ? prefix.length
    : line.length - line.trimStart().length;
  const token = value.replace(/,\s*$/, '');
  if (!token || STRUCTURAL_VALUE.test(token.trim())) return null;
  const trimmed = token.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return null;
  const isString = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  const tokenOffset = start + value.indexOf(token);
  const contentStart = tokenOffset + (isString ? 1 : 0);
  const contentEnd = tokenOffset + token.length - (isString ? 1 : 0);
  return {
    prefix,
    token,
    start: tokenOffset,
    contentStart,
    contentEnd,
    isString,
    indent: line.match(/^\s*/)?.[0] ?? '',
    isProperty: property !== null,
  };
}

function tokenRuns(value: string): Array<{ value: string; start: number; end: number }> {
  const tokens: Array<{ value: string; start: number; end: number }> = [];
  const pattern = /\s+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    tokens.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

interface TokenEdit {
  type: 'equal' | 'delete' | 'insert';
  beforeIndex?: number;
  afterIndex?: number;
}

function tokenLcsEdits(
  before: readonly { value: string }[],
  after: readonly { value: string }[],
): TokenEdit[] | null {
  if (before.length * after.length > MAX_INLINE_LCS_CELLS) return null;
  const table = Array.from(
    { length: before.length + 1 },
    () => new Uint16Array(after.length + 1),
  );
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i]!.value === after[j]!.value
          ? (table[i + 1]![j + 1] ?? 0) + 1
          : Math.max(table[i + 1]![j] ?? 0, table[i]![j + 1] ?? 0);
    }
  }
  const edits: TokenEdit[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i]!.value === after[j]!.value) {
      edits.push({ type: 'equal', beforeIndex: i, afterIndex: j });
      i += 1;
      j += 1;
    } else if (
      j < after.length &&
      (i >= before.length || (table[i]![j + 1] ?? 0) > (table[i + 1]![j] ?? 0))
    ) {
      edits.push({ type: 'insert', afterIndex: j });
      j += 1;
    } else {
      edits.push({ type: 'delete', beforeIndex: i });
      i += 1;
    }
  }
  return edits;
}

function freezeSpans(spans: InlineDiffSpan[]): ReadonlyArray<InlineDiffSpan> {
  return Object.freeze(
    spans.map((span) => Object.freeze({ start: span.start, end: span.end })),
  );
}

function mergeNearbySpans(spans: InlineDiffSpan[]): InlineDiffSpan[] {
  const sorted = spans
    .filter((span) => span.end > span.start)
    .sort((left, right) => left.start - right.start);
  const merged: InlineDiffSpan[] = [];
  for (const span of sorted) {
    const previous = merged.at(-1);
    // Keep short unchanged islands inside a single highlight. This avoids
    // turning one sentence edit into several tiny, hard-to-read marks.
    if (previous && span.start - previous.end < 3) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/**
 * Produce conservative offsets for the value regions of a removed/added JSON
 * line pair. Returns null when the lines cannot be paired as matching scalars.
 */
export function createInlineDiffSpans(
  beforeLine: string,
  afterLine: string,
): InlineDiffSpans | null {
  const before = jsonValueRegion(beforeLine);
  const after = jsonValueRegion(afterLine);
  if (
    !before ||
    !after ||
    before.isProperty !== after.isProperty ||
    before.prefix !== after.prefix ||
    (!before.isProperty && before.indent !== after.indent)
  ) {
    return null;
  }

  const beforeContent = beforeLine.slice(before.contentStart, before.contentEnd);
  const afterContent = afterLine.slice(after.contentStart, after.contentEnd);
  const maxLength = Math.max(beforeContent.length, afterContent.length);
  if (maxLength === 0 || before.token === after.token) return null;
  const beforeTokens = tokenRuns(beforeContent);
  const afterTokens = tokenRuns(afterContent);
  const edits = tokenLcsEdits(beforeTokens, afterTokens);
  if (!edits) {
    return {
      before: freezeSpans([{ start: before.start, end: before.start + before.token.length }]),
      after: freezeSpans([{ start: after.start, end: after.start + after.token.length }]),
    };
  }

  const beforeSpans: InlineDiffSpan[] = [];
  const afterSpans: InlineDiffSpan[] = [];
  let beforeStart: number | null = null;
  let beforeEnd = 0;
  let afterStart: number | null = null;
  let afterEnd = 0;
  const flush = (): void => {
    if (beforeStart !== null) {
      beforeSpans.push({
        start: before.contentStart + beforeStart,
        end: before.contentStart + beforeEnd,
      });
      beforeStart = null;
    }
    if (afterStart !== null) {
      afterSpans.push({
        start: after.contentStart + afterStart,
        end: after.contentStart + afterEnd,
      });
      afterStart = null;
    }
  };
  for (const edit of edits) {
    if (edit.type === 'equal') {
      flush();
    } else if (edit.type === 'delete') {
      const token = beforeTokens[edit.beforeIndex!]!;
      beforeStart ??= token.start;
      beforeEnd = token.end;
    } else {
      const token = afterTokens[edit.afterIndex!]!;
      afterStart ??= token.start;
      afterEnd = token.end;
    }
  }
  flush();

  const similarity = commonCharacterCount(beforeContent, afterContent) / maxLength;
  if (similarity < 0.5) {
    return {
      before: freezeSpans([{ start: before.start, end: before.start + before.token.length }]),
      after: freezeSpans([{ start: after.start, end: after.start + after.token.length }]),
    };
  }

  const mergedBefore = mergeNearbySpans(beforeSpans);
  const mergedAfter = mergeNearbySpans(afterSpans);
  const spanLimit = Math.max(beforeContent.length, afterContent.length) > 80 ? 3 : 2;
  if (
    mergedBefore.length > spanLimit ||
    mergedAfter.length > spanLimit
  ) {
    return {
      before: freezeSpans([{ start: before.start, end: before.start + before.token.length }]),
      after: freezeSpans([{ start: after.start, end: after.start + after.token.length }]),
    };
  }
  return {
    before: freezeSpans(mergedBefore),
    after: freezeSpans(mergedAfter),
  };
}

function inlinePairKey(line: string): { key: string; region: JsonValueRegion } | null {
  const region = jsonValueRegion(line);
  if (!region) return null;
  if (region.isProperty) return { key: `property:${region.prefix}`, region };
  return { key: `array:${region.indent}`, region };
}

function attachInlineSpans(lines: JsonDiffLine[]): JsonDiffLine[] {
  let cursor = 0;
  const spansByIndex = new Map<number, ReadonlyArray<InlineDiffSpan>>();
  while (cursor < lines.length) {
    if (lines[cursor]?.kind === 'context') {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < lines.length && lines[cursor]?.kind !== 'context') cursor += 1;
    const hunk = lines.slice(start, cursor);
    const removedByKey = new Map<
      string,
      Array<{ line: JsonDiffLine; index: number; region: JsonValueRegion }>
    >();
    const addedByKey = new Map<
      string,
      Array<{ line: JsonDiffLine; index: number; region: JsonValueRegion }>
    >();
    hunk.forEach((line, offset) => {
      const pair = inlinePairKey(line.text);
      if (!pair) return;
      const target = line.kind === 'removed' ? removedByKey : addedByKey;
      const entries = target.get(pair.key) ?? [];
      entries.push({ line, index: start + offset, region: pair.region });
      target.set(pair.key, entries);
    });

    for (const [key, removed] of removedByKey) {
      const added = addedByKey.get(key);
      if (!added) continue;
      const pairCount = Math.min(removed.length, added.length);
      for (let index = 0; index < pairCount; index += 1) {
        const oldEntry = removed[index]!;
        const newEntry = added[index]!;
        if (!oldEntry.region.isProperty) {
          const maxLength = Math.max(oldEntry.region.token.length, newEntry.region.token.length);
          const common = commonCharacterCount(oldEntry.region.token, newEntry.region.token);
          if (maxLength === 0 || common / maxLength < 0.5) continue;
        }
        const spans = createInlineDiffSpans(oldEntry.line.text, newEntry.line.text);
        if (spans) {
          if (spans.before.length > 0) spansByIndex.set(oldEntry.index, spans.before);
          if (spans.after.length > 0) spansByIndex.set(newEntry.index, spans.after);
        }
      }
    }
  }
  return lines.map((line, index) => {
    const inlineSpans = spansByIndex.get(index);
    return inlineSpans ? { ...line, inlineSpans } : line;
  });
}

function commonCharacterCount(left: string, right: string): number {
  if (left.length * right.length > MAX_INLINE_LCS_CELLS) return 0;
  let previous = new Uint16Array(right.length + 1);
  for (let i = 0; i < left.length; i += 1) {
    const current = new Uint16Array(right.length + 1);
    for (let j = 0; j < right.length; j += 1) {
      current[j + 1] =
        left[i] === right[j]
          ? (previous[j] ?? 0) + 1
          : Math.max(previous[j + 1] ?? 0, current[j] ?? 0);
    }
    previous = current;
  }
  return previous[right.length] ?? 0;
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
      lines.push({
        kind: 'context',
        text: edit.value,
        ...(edit.beforeValue === undefined ? {} : { beforeText: edit.beforeValue }),
        oldLine,
        newLine,
      });
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
  return { lines: attachInlineSpans(lines), added, removed };
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
    .map((line) => line.beforeText ?? line.text);
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
