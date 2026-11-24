import { describe, expect, it } from 'vitest';
import {
  parseTopLevelJsonString,
  streamTopLevelJsonObject,
} from '../streamJson';

function chunkedStream(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

async function collectStream(
  text: string,
  chunkSize: number,
  batchSize?: number,
): Promise<{ count: number; entries: Array<[string, string]>; batches: number[] }> {
  const entries: Array<[string, string]> = [];
  const batches: number[] = [];
  const count = await streamTopLevelJsonObject(
    chunkedStream(text, chunkSize),
    async (batch) => {
      batches.push(batch.length);
      entries.push(...batch);
    },
    batchSize,
  );
  return { count, entries, batches };
}

function parseEntries(entries: Array<[string, string]>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [key, raw] of entries) {
    map.set(key, JSON.parse(raw));
  }
  return map;
}

describe('parseTopLevelJsonString', () => {
  it('parses a simple top-level object', () => {
    const parsed = new Map<string, unknown>();
    const count = parseTopLevelJsonString('{ "a": 1, "b": 2 }', (key, raw) => {
      parsed.set(key, JSON.parse(raw));
    });
    expect(count).toBe(2);
    expect(parsed.get('a')).toBe(1);
    expect(parsed.get('b')).toBe(2);
  });

  it('handles escaped quotes and escaped backslashes inside string values', () => {
    const parsed = new Map<string, unknown>();
    parseTopLevelJsonString(
      '{ "a": "she said \\"hi\\"", "b": "backslash \\\\ here" }',
      (key, raw) => parsed.set(key, JSON.parse(raw)),
    );
    expect(parsed.get('a')).toBe('she said "hi"');
    expect(parsed.get('b')).toBe('backslash \\ here');
  });

  it('handles nested objects and arrays', () => {
    const parsed = new Map<string, unknown>();
    parseTopLevelJsonString(
      '{ "nested": { "x": [1, 2, { "y": [3, 4] }] }, "flat": [true, null, -1.5e2] }',
      (key, raw) => parsed.set(key, JSON.parse(raw)),
    );
    expect(parsed.get('nested')).toEqual({ x: [1, 2, { y: [3, 4] }] });
    expect(parsed.get('flat')).toEqual([true, null, -150]);
  });

  it('does not confuse braces/brackets inside strings with structure', () => {
    const parsed = new Map<string, unknown>();
    parseTopLevelJsonString(
      '{ "a": "}}]]", "b": "{{[[", "c": { "d": "nested } brace" } }',
      (key, raw) => parsed.set(key, JSON.parse(raw)),
    );
    expect(parsed.get('a')).toBe('}}]]');
    expect(parsed.get('b')).toBe('{{[[');
    expect(parsed.get('c')).toEqual({ d: 'nested } brace' });
  });

  it('handles an empty object', () => {
    const keys: string[] = [];
    const count = parseTopLevelJsonString('{}', (key) => keys.push(key));
    expect(count).toBe(0);
    expect(keys).toHaveLength(0);
  });

  it('handles an empty string value', () => {
    const parsed = new Map<string, unknown>();
    parseTopLevelJsonString('{ "a": "" }', (key, raw) => parsed.set(key, JSON.parse(raw)));
    expect(parsed.get('a')).toBe('');
  });
});

describe('streamTopLevelJsonObject', () => {
  it('streams a simple object from a single chunk', async () => {
    const { count, entries } = await collectStream('{ "a": 1, "b": 2 }', 1000);
    expect(count).toBe(2);
    expect(parseEntries(entries)).toEqual(new Map([['a', 1], ['b', 2]]));
  });

  it('splits multi-byte UTF-8 characters mid-sequence across small chunks', async () => {
    // 4-byte emoji and 3-byte CJK characters, deliberately split across 7-byte chunks.
    const text = '{ "😀": "🎉", "名前": "値", "emoji": "a😀b" }';
    const { count, entries } = await collectStream(text, 7);
    expect(count).toBe(3);
    expect(parseEntries(entries)).toEqual(
      new Map<string, unknown>([
        ['😀', '🎉'],
        ['名前', '値'],
        ['emoji', 'a😀b'],
      ]),
    );
  });

  it('parses a large single value spanning many chunks', async () => {
    const inner = Array.from({ length: 1000 }, (_, i) => `"k${i}":${i}`).join(',');
    const text = `{ "big": { ${inner} } }`;
    const { count, entries } = await collectStream(text, 13);
    expect(count).toBe(1);
    const big = JSON.parse(entries[0]![1]) as Record<string, number>;
    expect(Object.keys(big)).toHaveLength(1000);
    expect(big['k999']).toBe(999);
  });

  it('streams multi-megabyte string values as contiguous slices', async () => {
    const payload = 'solar🙂-brace{}-quote"\\-'.repeat(90_000);
    const text = JSON.stringify({ large: payload, trailing: { retained: true } });
    const { count, entries } = await collectStream(text, 32_768, 1);
    expect(count).toBe(2);
    expect(JSON.parse(entries[0]![1])).toBe(payload);
    expect(JSON.parse(entries[1]![1])).toEqual({ retained: true });
  });

  it('streams an empty object', async () => {
    const { count, entries } = await collectStream('{}', 1);
    expect(count).toBe(0);
    expect(entries).toHaveLength(0);
  });

  it('emits many entries in incremental batches', async () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 5000; i++) obj[String(i)] = i;
    const text = JSON.stringify(obj);
    const { count, entries, batches } = await collectStream(text, 100, 500);
    expect(count).toBe(5000);
    expect(entries).toHaveLength(5000);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.reduce((a, b) => a + b, 0)).toBe(5000);
    for (const batch of batches) {
      expect(batch).toBeGreaterThan(0);
    }
    const parsed = parseEntries(entries);
    expect(parsed.get('0')).toBe(0);
    expect(parsed.get('4999')).toBe(4999);
  });
});
