/**
 * Zero-dependency streaming parser for a single top-level JSON object.
 *
 * Bungie's `DestinyInventoryItemDefinition` is a ~199 MB top-level object:
 *
 *   { "73015": { ... }, "236588": { ... }, ... }
 *
 * Calling `JSON.parse` on the whole string OOMs mobile Safari/Chrome, so we
 * instead read `Uint8Array` chunks, decode them incrementally with a streaming
 * `TextDecoder`, and extract each `"key": <rawJsonValue>` pair as `[key, raw]`
 * without ever materialising the full document (or even a full value) as a
 * parsed object graph.
 */

export type TopLevelJsonEntry = [key: string, rawJson: string];
export type TopLevelJsonEntryHandler = (key: string, rawJson: string) => void;
export type TopLevelJsonBatchHandler = (
  entries: TopLevelJsonEntry[],
) => void | Promise<void>;

type Phase =
  | 'beforeObject'
  | 'expectKeyOrEnd'
  | 'inKey'
  | 'expectColon'
  | 'expectValue'
  | 'inValue'
  | 'done';

interface ParserState {
  phase: Phase;
  keyBuffer: string;
  valueBuffer: string;
  inString: boolean;
  escaped: boolean;
  valueIsCompound: boolean;
  valueBraceDepth: number;
  valueBracketDepth: number;
}

function createParserState(): ParserState {
  return {
    phase: 'beforeObject',
    keyBuffer: '',
    valueBuffer: '',
    inString: false,
    escaped: false,
    valueIsCompound: false,
    valueBraceDepth: 0,
    valueBracketDepth: 0,
  };
}

function isJsonWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function emitEntry(state: ParserState, emit: TopLevelJsonEntryHandler): void {
  emit(unescapeJsonString(state.keyBuffer), state.valueBuffer);
}

/**
 * Feed decoded text through the state machine. The state may be paused at any
 * character boundary (end of a chunk), so only complete entries are emitted and
 * partial keys/values are retained inside `state` for the next feed.
 */
function feedParser(
  state: ParserState,
  text: string,
  emit: TopLevelJsonEntryHandler,
): void {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    switch (state.phase) {
      case 'beforeObject':
        // Skip everything (whitespace) until the opening brace.
        if (ch === '{') state.phase = 'expectKeyOrEnd';
        break;

      case 'expectKeyOrEnd':
        if (ch === '}') {
          state.phase = 'done';
        } else if (ch === '"') {
          state.keyBuffer = '';
          state.inString = false;
          state.escaped = false;
          state.phase = 'inKey';
        }
        // Ignore whitespace and stray commas leniently.
        break;

      case 'inKey':
        if (state.escaped) {
          state.keyBuffer += ch;
          state.escaped = false;
        } else if (ch === '\\') {
          state.keyBuffer += ch;
          state.escaped = true;
        } else if (ch === '"') {
          state.phase = 'expectColon';
        } else {
          state.keyBuffer += ch;
        }
        break;

      case 'expectColon':
        if (ch === ':') state.phase = 'expectValue';
        break;

      case 'expectValue':
        if (isJsonWhitespace(ch)) break;
        state.valueBuffer = '';
        state.inString = false;
        state.escaped = false;
        state.valueBraceDepth = 0;
        state.valueBracketDepth = 0;
        if (ch === '{') {
          state.valueIsCompound = true;
          state.valueBraceDepth = 1;
        } else if (ch === '[') {
          state.valueIsCompound = true;
          state.valueBracketDepth = 1;
        } else {
          state.valueIsCompound = false;
          if (ch === '"') state.inString = true;
        }
        state.valueBuffer += ch;
        state.phase = 'inValue';
        break;

      case 'inValue':
        if (state.inString) {
          state.valueBuffer += ch;
          if (state.escaped) {
            state.escaped = false;
          } else if (ch === '\\') {
            state.escaped = true;
          } else if (ch === '"') {
            state.inString = false;
          }
        } else if (state.valueIsCompound) {
          state.valueBuffer += ch;
          if (ch === '"') {
            state.inString = true;
          } else if (ch === '{') {
            state.valueBraceDepth += 1;
          } else if (ch === '}') {
            state.valueBraceDepth -= 1;
            if (state.valueBraceDepth === 0 && state.valueBracketDepth === 0) {
              emitEntry(state, emit);
              state.phase = 'expectKeyOrEnd';
            }
          } else if (ch === '[') {
            state.valueBracketDepth += 1;
          } else if (ch === ']') {
            state.valueBracketDepth -= 1;
            if (state.valueBraceDepth === 0 && state.valueBracketDepth === 0) {
              emitEntry(state, emit);
              state.phase = 'expectKeyOrEnd';
            }
          }
        } else {
          // Scalar value: string / number / true / false / null.
          if (ch === ',' || ch === '}') {
            emitEntry(state, emit);
            state.phase = ch === '}' ? 'done' : 'expectKeyOrEnd';
          } else {
            state.valueBuffer += ch;
          }
        }
        break;

      case 'done':
        // Trailing content after the top-level object is ignored.
        break;
    }
  }
}

/** Decode JSON string escape sequences (used for top-level keys). */
function unescapeJsonString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charAt(i);
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = i + 1 < raw.length ? raw.charAt(i + 1) : '';
    if (next === '') {
      out += ch;
      continue;
    }
    switch (next) {
      case '"':
        out += '"';
        i += 1;
        break;
      case '\\':
        out += '\\';
        i += 1;
        break;
      case '/':
        out += '/';
        i += 1;
        break;
      case 'b':
        out += '\b';
        i += 1;
        break;
      case 'f':
        out += '\f';
        i += 1;
        break;
      case 'n':
        out += '\n';
        i += 1;
        break;
      case 'r':
        out += '\r';
        i += 1;
        break;
      case 't':
        out += '\t';
        i += 1;
        break;
      case 'u': {
        if (i + 5 < raw.length) {
          const hex = raw.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 5;
            break;
          }
        }
        out += ch;
        break;
      }
      default:
        out += ch;
        break;
    }
  }
  return out;
}

/**
 * Parse an entire top-level JSON object string synchronously, invoking
 * `onEntry(key, rawJson)` for each entry. Returns the number of entries.
 * Useful for unit testing and as a fallback when `response.body` is absent.
 */
export function parseTopLevelJsonString(
  text: string,
  onEntry: TopLevelJsonEntryHandler,
): number {
  const state = createParserState();
  let count = 0;
  feedParser(state, text, (key, rawJson) => {
    onEntry(key, rawJson);
    count += 1;
  });
  return count;
}

/**
 * Stream a top-level JSON object from a `ReadableStream<Uint8Array>`, emitting
 * `[key, rawJson]` pairs in batches of `batchSize`. Returns the total number of
 * entries. `onBatch` is awaited, providing natural back-pressure.
 */
export async function streamTopLevelJsonObject(
  stream: ReadableStream<Uint8Array>,
  onBatch: TopLevelJsonBatchHandler,
  batchSize = 500,
): Promise<number> {
  const decoder = new TextDecoder('utf-8');
  const state = createParserState();
  const reader = stream.getReader();
  let buffer = '';
  let count = 0;
  let batch: TopLevelJsonEntry[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const current = batch;
    batch = [];
    await onBatch(current);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.byteLength > 0) {
        buffer += decoder.decode(value, { stream: true });
      }
      if (buffer.length > 0) {
        feedParser(state, buffer, (key, rawJson) => {
          batch.push([key, rawJson]);
          count += 1;
        });
        buffer = '';
        if (batch.length >= batchSize) {
          await flush();
        }
      }
      if (done) break;
    }

    // Flush any trailing incomplete multi-byte sequence held by the decoder.
    const tail = decoder.decode();
    if (tail.length > 0) {
      feedParser(state, tail, (key, rawJson) => {
        batch.push([key, rawJson]);
        count += 1;
      });
    }
    await flush();
  } finally {
    reader.releaseLock();
  }

  return count;
}
