import { describe, expect, it } from 'vitest';
import {
  decodeEntryDates,
  encodeEntryDates,
  type DecodedEntryDates,
  type EntryDateRecord,
} from '../entryDates';
import {
  decodeEntryDates as decodeNodeEntryDates,
  encodeEntryDates as encodeNodeEntryDates,
} from '../../../scripts/history/entry-dates-codec.mjs';

const date = (firstVersionIndex: number, lastVersionIndex: number, firstInferred = false): EntryDateRecord => ({
  firstVersionIndex,
  lastVersionIndex,
  firstInferred,
});

function expectDecodedEqual(actual: DecodedEntryDates, expected: DecodedEntryDates): void {
  expect(actual.versionDates).toEqual(expected.versionDates);
  expect([...actual.tables].map(([table, records]) => [table, [...records]])).toEqual(
    [...expected.tables].map(([table, records]) => [table, [...records]]),
  );
}

describe('EDAT v1 codec', () => {
  const input: DecodedEntryDates = {
    versionDates: [1_500_000_000_000, 1_600_000_000_000, 1_700_000_000_000],
    tables: new Map([
      [
        'DestinyInventoryItemDefinition',
        new Map([
          [42, date(-1, -1)],
          [3_555_269_338, date(1, 2, true)],
          [4_294_967_295, date(0, 2)],
        ]),
      ],
      ['EmptyDefinition', new Map()],
      ['OtherDefinition', new Map([[0, date(0, 0)]])],
    ]),
  };

  it('round-trips high unsigned hashes, first-added, inferred, unknown, and empty tables', () => {
    const decoded = decodeEntryDates(encodeEntryDates(input));
    expectDecodedEqual(decoded, input);
    expect(decoded.tables.get('DestinyInventoryItemDefinition')?.has(4_294_967_295)).toBe(true);
    expect(decoded.tables.get('DestinyInventoryItemDefinition')?.has(3_555_269_338)).toBe(true);
    expect(decoded.tables.get('EmptyDefinition')?.size).toBe(0);
  });

  it('is byte-compatible with the Node ESM mirror in both directions', () => {
    const browserBytes = encodeEntryDates(input);
    const nodeBytes = encodeNodeEntryDates(input);
    expect([...nodeBytes]).toEqual([...browserBytes]);
    expectDecodedEqual(decodeEntryDates(nodeBytes), input);
    expectDecodedEqual(decodeNodeEntryDates(browserBytes), input);
  });

  it('rejects invalid magic and unsupported schema', () => {
    const valid = encodeEntryDates({ versionDates: [], tables: new Map() });
    const badMagic = valid.slice();
    badMagic[0] = 0;
    expect(() => decodeEntryDates(badMagic)).toThrow(/magic/i);
    const badSchema = valid.slice();
    badSchema[4] = 2;
    expect(() => decodeEntryDates(badSchema)).toThrow(/schema/i);
  });
});
