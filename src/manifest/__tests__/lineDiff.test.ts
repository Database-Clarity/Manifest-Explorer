import { describe, expect, it } from 'vitest';
import {
  createInlineDiffSpans,
  createJsonLineDiff,
  groupJsonDiffLines,
  type JsonDiffLine,
} from '../lineDiff';

describe('createJsonLineDiff', () => {
  it('prints full JSON and marks each changed line with old/new line numbers', () => {
    const diff = createJsonLineDiff(
      { name: 'Old', count: 1 },
      { name: 'New', count: 2 },
    );

    expect(diff.removed).toBe(2);
    expect(diff.added).toBe(2);
    expect(diff.lines.map((line) => [line.kind, line.text])).toEqual([
      ['context', '{'],
      ['removed', '  "name": "Old",'],
      ['removed', '  "count": 1'],
      ['added', '  "name": "New",'],
      ['added', '  "count": 2'],
      ['context', '}'],
    ]);
    expect(diff.lines[1]).toMatchObject({ oldLine: 2, newLine: null });
    expect(diff.lines[3]).toMatchObject({ oldLine: null, newLine: 2 });
  });

  it('treats a missing before snapshot as empty lines for an Added entry', () => {
    const diff = createJsonLineDiff(null, { a: 1 });

    expect(diff.lines.map((line) => line.kind)).toEqual(['added', 'added', 'added']);
    expect(diff.lines.map((line) => line.text)).toEqual(['{', '  "a": 1', '}']);
    expect(diff.removed).toBe(0);
    expect(diff.added).toBe(3);
  });

  it('treats undefined as an absent snapshot and supports primitive JSON values', () => {
    expect(createJsonLineDiff(undefined, 'hello').lines).toMatchObject([
      { kind: 'added', text: '"hello"', oldLine: null, newLine: 1 },
    ]);
  });

  it('produces no edits for equal JSON snapshots', () => {
    const diff = createJsonLineDiff({ nested: [1, 2] }, { nested: [1, 2] });

    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.lines.every((line) => line.kind === 'context')).toBe(true);
  });

  it('treats structural trailing-comma differences as context with valid side text', () => {
    const diff = createJsonLineDiff(
      { traitIds: ['item.armor.head', 'releases.v460.season'] },
      { traitIds: ['item.armor.head'] },
    );
    const sharedItem = diff.lines.find((line) => line.text.includes('item.armor.head'));

    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(0);
    expect(sharedItem).toMatchObject({
      kind: 'context',
      text: '    "item.armor.head"',
      beforeText: '    "item.armor.head",',
    });
    expect(sharedItem?.inlineSpans).toBeUndefined();
  });

  it('highlights only the changed word inside a same-key JSON string', () => {
    const spans = createInlineDiffSpans(
      '  "displayName": "The old weapon name",',
      '  "displayName": "The new weapon name",',
    );

    expect(spans).not.toBeNull();
    expect(
      '  "displayName": "The old weapon name",'.slice(
        spans!.before[0]!.start,
        spans!.before[0]!.end,
      ),
    ).toBe('old');
    expect(
      '  "displayName": "The new weapon name",'.slice(
        spans!.after[0]!.start,
        spans!.after[0]!.end,
      ),
    ).toBe('new');
    expect(Object.isFrozen(spans!.before)).toBe(true);
    expect(Object.isFrozen(spans!.before[0])).toBe(true);
  });

  it('keeps string quotes clean for a small edit inside one token', () => {
    const before = '  "label": "favorite"';
    const after = '  "label": "favourite"';
    const spans = createInlineDiffSpans(before, after);

    expect(spans).not.toBeNull();
    expect(before.slice(spans!.before[0]!.start, spans!.before[0]!.end)).toBe('favorite');
    expect(after.slice(spans!.after[0]!.start, spans!.after[0]!.end)).toBe('favourite');
  });

  it('falls back to the full value token rather than fragmenting a sentence', () => {
    const before = '  "summary": "red longseparator blue longseparator green longseparator black"';
    const after = '  "summary": "RED longseparator BLUE longseparator GREEN longseparator BLACK"';
    const spans = createInlineDiffSpans(before, after);

    expect(spans).not.toBeNull();
    expect(spans!.before).toHaveLength(1);
    expect(spans!.after).toHaveLength(1);
    expect(before.slice(spans!.before[0]!.start, spans!.before[0]!.end)).toBe(
      '"red longseparator blue longseparator green longseparator black"',
    );
  });

  it('does not pair structural lines or standalone array values with dissimilarity', () => {
    expect(createInlineDiffSpans('  "entry": {', '  "entry": [')).toBeNull();
    const diff = createJsonLineDiff(['old value'], ['different item']);
    expect(diff.lines.filter((line) => line.kind !== 'context')).toHaveLength(2);
    expect(
      diff.lines
        .filter((line) => line.kind !== 'context')
        .every((line) => line.inlineSpans === undefined),
    ).toBe(true);
  });

  it('groups unchanged lines into hunks with three lines of default context', () => {
    const lines: JsonDiffLine[] = Array.from({ length: 20 }, (_, index) => ({
      kind: index === 10 ? 'added' : 'context',
      text: String(index),
      oldLine: index + 1,
      newLine: index === 10 ? null : index + 1,
    }));

    expect(groupJsonDiffLines(lines)).toEqual([
      { type: 'collapsed', start: 0, end: 7 },
      { type: 'visible', start: 7, end: 14 },
      { type: 'collapsed', start: 14, end: 20 },
    ]);
    expect(groupJsonDiffLines(lines, 3, new Set([6]))).toEqual([
      { type: 'collapsed', start: 0, end: 6 },
      { type: 'visible', start: 6, end: 14 },
      { type: 'collapsed', start: 14, end: 20 },
    ]);
  });

  it('adds a scope breadcrumb when a deep hunk starts below its enclosing keys', () => {
    const before = {
      sockets: {
        socketEntries: [
          {
            reusablePlugItems: [{ hash: 1 }, { hash: 2 }],
          },
        ],
      },
    };
    const after = {
      sockets: {
        socketEntries: [
          {
            reusablePlugItems: [{ hash: 1 }, { hash: 3 }],
          },
        ],
      },
    };
    const diff = createJsonLineDiff(before, after);
    const hunk = groupJsonDiffLines(diff.lines).find(
      (segment) => segment.type === 'visible',
    );

    expect(hunk?.scope).toEqual([
      'sockets',
      'socketEntries[0]',
      'reusablePlugItems[1]',
    ]);
  });

  it('keeps common lines around a large edit while staying bounded', () => {
    const before = { lines: Array.from({ length: 5_000 }, (_, i) => `before-${i}`) };
    const after = { lines: Array.from({ length: 5_000 }, (_, i) => `before-${i}`) };
    after.lines[2_500] = 'after-2500';

    const diff = createJsonLineDiff(before, after);

    expect(diff.removed).toBe(1);
    expect(diff.added).toBe(1);
    expect(diff.lines.some((line) => line.text.includes('before-2499'))).toBe(true);
    expect(diff.lines.some((line) => line.text.includes('after-2500'))).toBe(true);
  });

  it('finds a precise edit script with Myers when the middle matrix would be large', () => {
    const before = { values: Array.from({ length: 600 }, (_, i) => `old-${i}`) };
    const after = {
      values: before.values.map((value, index) =>
        index % 5 === 0 || index === 599 ? `new-${index}` : value,
      ),
    };

    const diff = createJsonLineDiff(before, after);

    expect(diff.removed).toBe(121);
    expect(diff.added).toBe(121);
    expect(diff.lines.some((line) => line.text.includes('"old-300"'))).toBe(true);
    expect(diff.lines.some((line) => line.text.includes('"new-300"'))).toBe(true);
  });

  it('uses a fast coarse fallback for massive unrelated middle sections without dropping lines', () => {
    const before = { values: Array.from({ length: 1_000 }, (_, i) => `old-${i}`) };
    const after = { values: Array.from({ length: 1_000 }, (_, i) => `new-${i}`) };

    const diff = createJsonLineDiff(before, after);

    expect(diff.removed).toBe(1_000);
    expect(diff.added).toBe(1_000);
    expect(diff.lines[0]?.text).toBe('{');
    expect(diff.lines.at(-1)?.text).toBe('}');
  });
});
