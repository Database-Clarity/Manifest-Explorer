export interface EntryDateRecord {
  firstVersionIndex: number;
  lastVersionIndex: number;
  firstInferred: boolean;
}

export interface DecodedEntryDates {
  versionDates: number[];
  tables: Map<string, Map<number, EntryDateRecord>>;
}

export declare const ENTRY_DATES_MAGIC: 'EDAT';
export declare const ENTRY_DATES_SCHEMA: 1;
export declare function encodeEntryDates(input: {
  versionDates: number[];
  tables: Map<string, Map<number, EntryDateRecord>>;
}): Uint8Array;
export declare function decodeEntryDates(buffer: ArrayBuffer | Uint8Array): DecodedEntryDates;
