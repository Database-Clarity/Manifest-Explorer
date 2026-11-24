/**
 * Compact, browser-safe codec for the per-entry Manifest first/last revision
 * index. The containing artifact is gzip-compressed by the build pipeline.
 */

export interface EntryDateRecord {
  /** 0-based first `a` revision (or MIN(v) when inferred), or -1 if unknown */
  firstVersionIndex: number;
  /** 0-based last revision, or -1 if unknown */
  lastVersionIndex: number;
  /** True when there was no `a` revision and firstVersionIndex is an upper bound */
  firstInferred: boolean;
}

export interface DecodedEntryDates {
  /** Epoch milliseconds indexed by version index (0..versionCount-1) */
  versionDates: number[];
  /** Map of canonical table name -> Map<hashNumber, EntryDateRecord> */
  tables: Map<string, Map<number, EntryDateRecord>>;
}

export const ENTRY_DATES_MAGIC = 'EDAT';
export const ENTRY_DATES_SCHEMA = 1;

const MAGIC_BYTES = [0x45, 0x44, 0x41, 0x54];
const UINT32_MAX = 0xffff_ffff;
const MAX_VERSION_INDEX = 4094;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

interface EntryDatesInput {
  versionDates: number[];
  tables: Map<string, Map<number, EntryDateRecord>>;
}

function assertInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} through ${max}`);
  }
}

function writeVarUint32(output: number[], value: number): void {
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    output.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  output.push(remaining);
}

function readVarUint32(bytes: Uint8Array, state: { offset: number }): number {
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 5; index += 1) {
    if (state.offset >= bytes.length) throw new Error('Truncated EDAT varint');
    const byte = bytes[state.offset++] ?? 0;
    value += (byte & 0x7f) * multiplier;
    if (value > UINT32_MAX) throw new Error('EDAT varint exceeds unsigned 32-bit range');
    if ((byte & 0x80) === 0) {
      if (index === 4 && byte > 0x0f) throw new Error('EDAT varint exceeds unsigned 32-bit range');
      return value;
    }
    multiplier *= 0x80;
  }
  throw new Error('Invalid EDAT varint');
}

function writeBits(bytes: Uint8Array, bitOffset: number, value: number, bitCount: number): void {
  for (let bit = 0; bit < bitCount; bit += 1) {
    if (Math.floor(value / 2 ** bit) % 2 === 1) {
      const position = bitOffset + bit;
      const byteIndex = position >>> 3;
      bytes[byteIndex] = (bytes[byteIndex] ?? 0) | (1 << (position & 7));
    }
  }
}

function readBits(bytes: Uint8Array, bitOffset: number, bitCount: number): number {
  let value = 0;
  for (let bit = 0; bit < bitCount; bit += 1) {
    const position = bitOffset + bit;
    const set = ((bytes[position >>> 3] ?? 0) & (1 << (position & 7))) !== 0;
    if (set) value += 2 ** bit;
  }
  return value;
}

/**
 * Encode EDAT schema v1. Dates are supplied as epoch milliseconds and stored
 * as unsigned epoch seconds; entry hashes are sorted and delta-varint encoded.
 */
export function encodeEntryDates(input: EntryDatesInput): Uint8Array {
  const { versionDates, tables } = input;
  assertInteger(versionDates.length, 0, 0xffff, 'versionCount');
  assertInteger(tables.size, 0, 0xffff, 'tableCount');

  const output: number[] = [...MAGIC_BYTES, ENTRY_DATES_SCHEMA, 0];
  output.push(versionDates.length & 0xff, versionDates.length >>> 8);
  for (const date of versionDates) {
    if (!Number.isFinite(date) || date < 0) {
      throw new RangeError('Version dates must be finite non-negative epoch milliseconds');
    }
    const seconds = Math.floor(date / 1000);
    assertInteger(seconds, 0, UINT32_MAX, 'version timestamp seconds');
    output.push(
      seconds & 0xff,
      (seconds >>> 8) & 0xff,
      (seconds >>> 16) & 0xff,
      (seconds >>> 24) & 0xff,
    );
  }
  output.push(tables.size & 0xff, tables.size >>> 8);

  for (const [tableName, records] of tables) {
    const nameBytes = textEncoder.encode(tableName);
    assertInteger(nameBytes.length, 1, 0xffff, 'table name byte length');
    assertInteger(records.size, 0, UINT32_MAX, `entry count for ${tableName}`);
    output.push(nameBytes.length & 0xff, nameBytes.length >>> 8);
    for (const byte of nameBytes) output.push(byte);
    const count = records.size;
    output.push(count & 0xff, (count >>> 8) & 0xff, (count >>> 16) & 0xff, count >>> 24);

    const entries = [...records.entries()].map(([hash, record]) => {
      assertInteger(hash, 0, UINT32_MAX, `hash in ${tableName}`);
      assertInteger(record.firstVersionIndex, -1, MAX_VERSION_INDEX, 'firstVersionIndex');
      assertInteger(record.lastVersionIndex, -1, MAX_VERSION_INDEX, 'lastVersionIndex');
      if (typeof record.firstInferred !== 'boolean') {
        throw new TypeError('firstInferred must be a boolean');
      }
      return [hash >>> 0, record] as const;
    }).sort((left, right) => left[0] - right[0]);

    let previousHash = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) throw new Error('Unexpected missing entry while encoding EDAT');
      const [hash] = entry;
      const delta = index === 0 ? hash : hash - previousHash;
      writeVarUint32(output, delta);
      previousHash = hash;
    }

    const packed = new Uint8Array(Math.ceil((entries.length * 25) / 8));
    entries.forEach(([, record], index) => {
      const bitOffset = index * 25;
      writeBits(packed, bitOffset, record.firstVersionIndex + 1, 12);
      writeBits(packed, bitOffset + 12, record.lastVersionIndex + 1, 12);
      writeBits(packed, bitOffset + 24, record.firstInferred ? 1 : 0, 1);
    });
    for (const byte of packed) output.push(byte);
  }

  return Uint8Array.from(output);
}

/** Decode and validate an uncompressed EDAT schema v1 payload. */
export function decodeEntryDates(buffer: ArrayBuffer | Uint8Array): DecodedEntryDates {
  const bytes =
    buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const state = { offset: 0 };
  const readByte = (): number => {
    if (state.offset >= bytes.length) throw new Error('Truncated EDAT payload');
    return bytes[state.offset++] ?? 0;
  };
  const readU16 = (): number => readByte() | (readByte() << 8);
  const readU32 = (): number =>
    readByte() + readByte() * 0x100 + readByte() * 0x10000 + readByte() * 0x1000000;

  for (const expected of MAGIC_BYTES) {
    if (readByte() !== expected) throw new Error('Invalid EDAT magic');
  }
  const schema = readByte();
  if (schema !== ENTRY_DATES_SCHEMA) throw new Error(`Unsupported EDAT schema: ${schema}`);
  const flags = readByte();
  if (flags !== 0) throw new Error(`Unsupported EDAT flags: ${flags}`);

  const versionCount = readU16();
  const versionDates = Array.from({ length: versionCount }, () => readU32() * 1000);
  const tableCount = readU16();
  const tables = new Map<string, Map<number, EntryDateRecord>>();
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex += 1) {
    const nameLength = readU16();
    if (nameLength === 0 || state.offset + nameLength > bytes.length) {
      throw new Error('Invalid or truncated EDAT table name');
    }
    let tableName: string;
    try {
      tableName = textDecoder.decode(bytes.subarray(state.offset, state.offset + nameLength));
    } catch {
      throw new Error('Invalid UTF-8 EDAT table name');
    }
    state.offset += nameLength;
    if (tables.has(tableName)) throw new Error(`Duplicate EDAT table: ${tableName}`);
    const entryCount = readU32();
    const packedLength = Math.ceil((entryCount * 25) / 8);
    if (packedLength > bytes.length - state.offset) throw new Error('Truncated EDAT date records');
    const hashes = new Array<number>(entryCount);
    let previousHash = 0;
    for (let index = 0; index < entryCount; index += 1) {
      const delta = readVarUint32(bytes, state);
      const hash = index === 0 ? delta : previousHash + delta;
      if (hash > UINT32_MAX || (index > 0 && delta === 0)) {
        throw new Error('Invalid EDAT hash delta');
      }
      hashes[index] = hash;
      previousHash = hash;
    }

    if (state.offset + packedLength > bytes.length) throw new Error('Truncated EDAT date records');
    const packed = bytes.subarray(state.offset, state.offset + packedLength);
    state.offset += packedLength;
    const records = new Map<number, EntryDateRecord>();
    for (let index = 0; index < entryCount; index += 1) {
      const bitOffset = index * 25;
      const firstPlusOne = readBits(packed, bitOffset, 12);
      const lastPlusOne = readBits(packed, bitOffset + 12, 12);
      const hash = hashes[index];
      if (hash === undefined) throw new Error('Unexpected missing hash while decoding EDAT');
      records.set(hash, {
        firstVersionIndex: firstPlusOne - 1,
        lastVersionIndex: lastPlusOne - 1,
        firstInferred: readBits(packed, bitOffset + 24, 1) === 1,
      });
    }
    tables.set(tableName, records);
  }
  if (state.offset !== bytes.length) throw new Error('Unexpected trailing bytes in EDAT payload');
  return { versionDates, tables };
}
