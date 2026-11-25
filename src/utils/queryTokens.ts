/**
 * Pure helpers for editing structured filter tokens (like `is:enhanced` or
 * `cat:"Hand Cannon"`) inside the search-bar query string. The Filters popover
 * uses them so every chip visibly writes its exact syntax into the search bar,
 * where the user can edit, combine, and share it.
 *
 * Tokens follow DIM's search-bar semantics: filters AND together by default,
 * while multiple selections from one filter category are OR-joined inside
 * parentheses — `tier:exotic (element:solar or element:arc)` is an exotic that is
 * solar OR arc. Hand-typed `or`/`and`/`not`, `-` negation (glued or spaced),
 * `not:x` shorthand, single- and smart-quoted values, range comparisons
 * (`season:>=24`), and parentheses are preserved and edited in place, never
 * corrupted.
 */

/** Filter categories the popover groups its chips into. */
export type FilterGroupId =
  | 'highlights'
  | 'tier'
  | 'damage'
  | 'ammo'
  | 'slot'
  | 'class'
  | 'type'
  | 'subtype'
  | 'season'
  | 'source'
  | 'category';

/** Query keys per filter category; all matched case-insensitively. */
const GROUP_KEYS: Readonly<Record<FilterGroupId, readonly string[]>> = {
  highlights: ['is', 'has'],
  tier: ['tier', 'rarity'],
  damage: ['element', 'damage', 'el', 'dmg'],
  ammo: ['ammo'],
  slot: ['slot'],
  class: ['class'],
  type: ['type'],
  subtype: ['subtype', 'weapon'],
  season: ['season', 's'],
  source: ['source'],
  category: ['cat', 'category', 'categories'],
};

const KEY_TO_GROUP: Readonly<Record<string, FilterGroupId>> = buildKeyToGroup();

function buildKeyToGroup(): Readonly<Record<string, FilterGroupId>> {
  const map: Record<string, FilterGroupId> = {};
  for (const group of Object.keys(GROUP_KEYS) as FilterGroupId[]) {
    for (const key of GROUP_KEYS[group]) map[key] = group;
  }
  return map;
}

/**
 * Keys the manifest query parser recognizes as structured filters (mirrors
 * query.ts). Bare hashes remain free text; `hash:`/`h:` are structured filters.
 * `not:` is DIM shorthand for `-is:` and always reads as a negated filter.
 */
const FILTER_KEYS: ReadonlySet<string> = new Set([
  'table',
  't',
  'tier',
  'rarity',
  'damage',
  'element',
  'el',
  'dmg',
  'class',
  'type',
  'subtype',
  'weapon',
  'ammo',
  'slot',
  'season',
  's',
  'source',
  'trait',
  'cat',
  'category',
  'categories',
  'is',
  'has',
  'hash',
  'h',
  'not',
]);

/** Stable query key used when comparing canonical tokens with their aliases. */
const CANONICAL_GROUP_KEYS: Readonly<Record<FilterGroupId, string>> = {
  highlights: 'flag',
  tier: 'tier',
  damage: 'element',
  ammo: 'ammo',
  slot: 'slot',
  class: 'class',
  type: 'type',
  subtype: 'subtype',
  season: 'season',
  source: 'source',
  category: 'category',
};

const UNGROUPED_KEY_ALIASES: Readonly<Record<string, string>> = {
  t: 'table',
  h: 'hash',
};

function normalizeTableValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^destiny/, '')
    .replace(/definition$/, '')
    .replace(/lite$/, '');
}

/**
 * Maps a structured filter token to its popover category — `damage:solar` ->
 * 'damage', `cat:"Hand Cannon"` -> 'category'. Unstructured keys (`table:`,
 * `trait:`, `hash:`) and free text return null.
 */
export function filterGroupIdForToken(token: string): FilterGroupId | null {
  const key = tokenKey(token);
  return key === null ? null : KEY_TO_GROUP[key] ?? null;
}

/** Lowercased filter key of a token (`damage` for `Damage:Solar`), or null. */
function tokenKey(token: string): string | null {
  const body = token.startsWith('-') ? token.slice(1) : token;
  const colon = body.indexOf(':');
  if (colon <= 0) return null;
  const key = body.slice(0, colon).trim().toLowerCase();
  if (!FILTER_KEYS.has(key)) return null;
  return body.slice(colon + 1).trim().length > 0 ? key : null;
}

/* -------------------------------------------------------------------------- */
/* Query part model                                                            */
/* -------------------------------------------------------------------------- */

interface BasePart {
  /** Editing passes mark parts dead instead of splicing mid-walk. */
  dead: boolean;
}

interface FilterPart extends BasePart {
  kind: 'filter';
  /** Original text, including a leading `-` when inline-negated. */
  raw: string;
  /** True for `-token`, `not token`, or anything inside a negated group. */
  negated: boolean;
}

interface WordPart extends BasePart {
  kind: 'word';
  raw: string;
}

interface OpPart extends BasePart {
  kind: 'op';
  op: 'or' | 'and' | 'not';
}

interface ParenPart extends BasePart {
  kind: 'paren';
  open: boolean;
  /** True for `-(...)` and `not (...)` groups. */
  negated: boolean;
}

type QueryPart = FilterPart | WordPart | OpPart | ParenPart;

function makeFilterPart(raw: string, negated: boolean): FilterPart {
  return { kind: 'filter', raw, negated, dead: false };
}

function makeWordPart(raw: string): WordPart {
  return { kind: 'word', raw, dead: false };
}

function makeOpPart(op: 'or' | 'and' | 'not'): OpPart {
  return { kind: 'op', op, dead: false };
}

function makeParenPart(open: boolean, negated = false): ParenPart {
  return { kind: 'paren', open, negated, dead: false };
}

/** Maps smart quotes to their ASCII equivalents, like DIM's canonicalizer. */
function canonicalizeQuotes(raw: string): string {
  return raw.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

/**
 * Splits a query into parts: structured filters, free-text words, boolean
 * operators, and parentheses. Smart quotes are canonicalized first; quoted
 * segments (double or single) stay glued together — quotes only open at a
 * token boundary, so plain apostrophes (`Izanagi's`) never glue — and a
 * standalone `-` before whitespace negates the next token or group, exactly
 * like the word `not`. Parentheses may hug their contents
 * (`(damage:solar or damage:arc)`).
 */
function parseQueryParts(raw: string): QueryPart[] {
  const query = canonicalizeQuotes(raw);
  const parts: QueryPart[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  const flush = (nextIndex: number): void => {
    const atom = current;
    current = '';
    if (atom.length === 0) return;
    if (atom === '-') {
      // `- is:exotic` negates just like `not is:exotic` — but a stray
      // trailing dash (or one before a `)`) still drops out as before.
      let look = nextIndex;
      while (look < query.length && /\s/.test(query.charAt(look))) look++;
      if (look < query.length && query.charAt(look) !== ')') parts.push(makeOpPart('not'));
      return;
    }
    parts.push(classifyAtom(atom, parts[parts.length - 1]));
  };

  for (let i = 0; i < query.length; i++) {
    const char = query.charAt(i);
    if (char === '\\' && (query.charAt(i + 1) === '"' || query.charAt(i + 1) === "'")) {
      // Escaped quotes (`\"`, `\'`) stay literal wherever they appear.
      current += char + query.charAt(i + 1);
      i++;
      continue;
    }
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      // Quotes open only at a token boundary (start, after `-`, after `:`)
      // so apostrophes inside plain words never start a quoted value.
      if (current.length === 0 || current === '-' || current.endsWith(':')) quote = char;
      current += char;
      continue;
    }
    if (char === '(' || char === ')') {
      if (char === '(' && current === '-') {
        // `-(...)` folds the dash into the group's opening paren.
        current = '';
        parts.push(makeParenPart(true, true));
      } else {
        flush(i);
        const prev = parts[parts.length - 1];
        const negated =
          char === '(' && prev !== undefined && prev.kind === 'op' && prev.op === 'not';
        parts.push(makeParenPart(char === '(', negated));
      }
      continue;
    }
    if (/\s/.test(char)) {
      flush(i + 1);
      continue;
    }
    current += char;
  }
  flush(query.length);
  annotateGroupNegation(balanceParens(parts));
  return parts;
}

function classifyAtom(atom: string, prev: QueryPart | undefined): QueryPart {
  const lower = atom.toLowerCase();
  if (!atom.startsWith('"') && (lower === 'or' || lower === 'and' || lower === 'not')) {
    return makeOpPart(lower);
  }
  const key = tokenKey(atom);
  if (key !== null) {
    const notBefore = prev !== undefined && prev.kind === 'op' && prev.op === 'not' && !prev.dead;
    // `not:value` is DIM shorthand for `-is:value`, so it is always negated.
    const negated = key === 'not' || atom.startsWith('-') || notBefore;
    return makeFilterPart(atom, negated);
  }
  return makeWordPart(atom);
}

/** Converts unmatched parens back into plain words so editing stays balanced. */
function balanceParens(parts: QueryPart[]): QueryPart[] {
  const stack: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part.kind !== 'paren') continue;
    if (part.open) {
      stack.push(i);
      continue;
    }
    if (stack.pop() === undefined) parts[i] = makeWordPart(')');
  }
  for (const open of stack) {
    const part = parts[open];
    if (part !== undefined && part.kind === 'paren') {
      parts[open] = makeWordPart(part.negated ? '-(' : '(');
    }
  }
  return parts;
}

/** Propagates `-(...)` / `not (...)` group negation onto every filter inside. */
function annotateGroupNegation(parts: QueryPart[]): void {
  const negatedGroups: boolean[] = [];
  for (const part of parts) {
    if (part.kind === 'paren') {
      if (part.open) negatedGroups.push(part.negated);
      else negatedGroups.pop();
      continue;
    }
    if (part.kind === 'filter') {
      part.negated = part.negated || negatedGroups.some(Boolean);
    }
  }
}

interface ParenMatch {
  /** Live `(` index -> matching live `)` index. */
  openToClose: Map<number, number>;
  /** Part index -> enclosing live `(` index (-1 at top level). */
  enclosing: number[];
}

function matchParens(parts: QueryPart[]): ParenMatch {
  const openToClose = new Map<number, number>();
  const enclosing: number[] = new Array<number>(parts.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part.dead) continue;
    enclosing[i] = stack.length > 0 ? (stack[stack.length - 1] ?? -1) : -1;
    if (part.kind === 'paren') {
      if (part.open) {
        stack.push(i);
      } else {
        const open = stack.pop();
        if (open !== undefined) openToClose.set(open, i);
      }
    }
  }
  return { openToClose, enclosing };
}

/** Unwraps a matching outer pair of double or single quotes, if present. */
function stripMatchingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Turns `\"` and `\'` back into literal quote characters. */
function unescapeQuotes(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\'/g, "'");
}

/**
 * Normalizes a token for comparison: lowercase, aliases folded to their
 * canonical key, smart quotes canonicalized, quoted values unwrapped (double
 * or single) and escaped quotes unescaped. A leading `-` (negation) is kept.
 */
function normalizeQueryToken(token: string): string {
  const trimmed = canonicalizeQuotes(token).trim();
  if (trimmed.length === 0) return '';

  const negated = trimmed.startsWith('-');
  const body = negated ? trimmed.slice(1) : trimmed;
  const colon = body.indexOf(':');
  if (colon <= 0) return unescapeQuotes(trimmed.toLowerCase());

  const key = body.slice(0, colon).toLowerCase();
  const value = unescapeQuotes(stripMatchingQuotes(body.slice(colon + 1).trim()));
  const group = KEY_TO_GROUP[key];
  const canonicalKey = group === undefined
    ? (UNGROUPED_KEY_ALIASES[key] ?? key)
    : CANONICAL_GROUP_KEYS[group];
  const canonicalValue =
    canonicalKey === 'table' ? normalizeTableValue(value) : value.toLowerCase();
  return `${negated ? '-' : ''}${canonicalKey}:${canonicalValue}`;
}

/* -------------------------------------------------------------------------- */
/* Reading the query                                                           */
/* -------------------------------------------------------------------------- */

/**
 * True when the query contains the token as an ACTIVE (positive) chip —
 * including inside parentheses. Negated forms (`-damage:solar`,
 * `not damage:solar`, `-(...)` groups) never count.
 */
export function hasQueryToken(query: string, token: string): boolean {
  const needle = normalizeQueryToken(token);
  if (needle.length === 0) return false;
  return parseQueryParts(query).some(
    (part) => part.kind === 'filter' && !part.negated && normalizeQueryToken(part.raw) === needle,
  );
}

/** Number of structured filter tokens (like `tier:exotic` or `-is:redacted`), parens included. */
export function countQueryFilterTokens(query: string): number {
  let count = 0;
  for (const part of parseQueryParts(query)) {
    if (part.kind === 'filter') count++;
  }
  return count;
}

/**
 * Removes every structured filter token (plus emptied parentheses and dangling
 * boolean operators) while keeping free-text search words — `deep:` prefixes,
 * bare hashes, and quoted phrases — exactly as typed.
 */
export function clearQueryFilterTokens(query: string): string {
  const parts = parseQueryParts(query);
  const affected = new Set<number>([-1]);
  for (const part of parts) {
    if (part.kind === 'filter') part.dead = true;
  }
  for (const open of matchParens(parts).openToClose.keys()) affected.add(open);
  return renderParts(sweepParts(parts, affected, false));
}

/* -------------------------------------------------------------------------- */
/* Toggling chips                                                              */
/* -------------------------------------------------------------------------- */

/** A run of positive filters from one category — bare, or a paren group. */
interface GroupRun {
  kind: 'bare' | 'group';
  /** bare: the filter part; group: the `(` part. */
  startIndex: number;
  /** group only: the `)` part. */
  closeIndex: number;
  /** Indices of the run's positive filters from the target category. */
  filterIndices: number[];
}

type GroupBelongs = (part: FilterPart) => boolean;

function findGroupRuns(
  parts: QueryPart[],
  matches: ParenMatch,
  belongs: GroupBelongs,
): GroupRun[] {
  const bare: GroupRun[] = [];
  const grouped = new Map<number, number[]>();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part.dead || part.kind !== 'filter' || part.negated) continue;
    if (!belongs(part)) continue;
    const enclosing = matches.enclosing[i] ?? -1;
    if (enclosing === -1) {
      bare.push({ kind: 'bare', startIndex: i, closeIndex: -1, filterIndices: [i] });
      continue;
    }
    const list = grouped.get(enclosing);
    if (list === undefined) grouped.set(enclosing, [i]);
    else list.push(i);
  }

  const runs = [...bare];
  for (const [open, filterIndices] of grouped) {
    const close = matches.openToClose.get(open);
    if (close === undefined) continue;
    runs.push({ kind: 'group', startIndex: open, closeIndex: close, filterIndices });
  }
  runs.sort((a, b) => a.startIndex - b.startIndex);
  return runs;
}

function groupBelongsTo(groupId: FilterGroupId): GroupBelongs {
  return (part) => {
    const key = tokenKey(part.raw);
    return key !== null && (KEY_TO_GROUP[key] ?? null) === groupId;
  };
}

function tokensBelongsTo(tokens: readonly string[]): GroupBelongs {
  const members = new Set(tokens.map(normalizeQueryToken));
  return (part) => members.has(normalizeQueryToken(part.raw));
}

/**
 * Toggles a chip within an explicit filter category. Adding joins the
 * category's other selections into a parenthesized OR group (creating or
 * extending it in place); removing unwraps redundant parens and never leaves
 * dangling operators or empty groups.
 */
export function toggleQueryTokenInGroup(
  query: string,
  token: string,
  groupId: FilterGroupId,
): string {
  return toggleWithBelongs(query, token, groupBelongsTo(groupId));
}

/**
 * Adds the token when absent, or removes it when present.
 * With `groupTokens` (a category's full option list), other positive members
 * of that category are OR-joined into parentheses. Without it, the token's own
 * key decides its category (`damage:*` -> damage, …); unstructured keys
 * (`table:*`, `trait:*`, free text) toggle plainly.
 */
export function toggleQueryToken(
  query: string,
  token: string,
  groupTokens?: readonly string[],
): string {
  if (groupTokens !== undefined) {
    return toggleWithBelongs(query, token, tokensBelongsTo(groupTokens));
  }
  const groupId = filterGroupIdForToken(token);
  if (groupId !== null) return toggleQueryTokenInGroup(query, token, groupId);
  return togglePlain(query, token);
}

function togglePlain(query: string, token: string): string {
  const cleanToken = token.trim();
  const needle = normalizeQueryToken(cleanToken);
  if (needle.length === 0 || cleanToken.length === 0) return query.trim();

  const parts = parseQueryParts(query);
  const occurrences = positiveOccurrences(parts, needle);
  if (occurrences.length === 0) {
    parts.push(makeFilterPart(cleanToken, false));
    return renderParts(parts);
  }
  return renderParts(removeFilterParts(parts, new Set(occurrences)));
}

function toggleWithBelongs(query: string, token: string, belongs: GroupBelongs): string {
  const cleanToken = token.trim();
  const needle = normalizeQueryToken(cleanToken);
  if (needle.length === 0 || cleanToken.length === 0) return query.trim();

  const parts = parseQueryParts(query);
  const occurrences = positiveOccurrences(parts, needle);
  if (occurrences.length > 0) {
    // The chip is on: turn it off, wherever it appears.
    return renderParts(removeFilterParts(parts, new Set(occurrences)));
  }

  const matches = matchParens(parts);
  const runs = findGroupRuns(parts, matches, belongs);

  if (runs.length === 0) {
    // First chip in this category: a bare, ANDed token.
    parts.push(makeFilterPart(cleanToken, false));
    return renderParts(parts);
  }

  const first = runs[0];
  if (first === undefined) return renderParts(parts);

  if (runs.length === 1 && first.kind === 'bare') {
    // Replace the lone category token in place with an OR group.
    const existing = parts[first.startIndex];
    const existingRaw =
      existing !== undefined && existing.kind === 'filter' ? existing.raw : cleanToken;
    parts.splice(
      first.startIndex,
      1,
      makeParenPart(true),
      makeFilterPart(existingRaw, false),
      makeOpPart('or'),
      makeFilterPart(cleanToken, false),
      makeParenPart(false),
    );
    return renderParts(parts);
  }

  if (runs.length === 1 && first.kind === 'group') {
    // Extend the existing OR group, reusing a trailing operator if the
    // hand-typed query left one dangling (`(damage:solar or)`).
    const before = parts[first.closeIndex - 1];
    const emptyGroup = first.closeIndex - 1 === first.startIndex;
    const trailingOperator =
      before !== undefined && before.kind === 'op' && (before.op === 'or' || before.op === 'and');
    const inserts: QueryPart[] =
      trailingOperator || emptyGroup
        ? [makeFilterPart(cleanToken, false)]
        : [makeOpPart('or'), makeFilterPart(cleanToken, false)];
    parts.splice(first.closeIndex, 0, ...inserts);
    return renderParts(parts);
  }

  // Multiple runs of one category: merge everything into a single OR group at
  // the first run's position, without disturbing other terms or free text.
  const raws: string[] = [];
  const seen = new Set<string>();
  const removals = new Set<number>();
  for (const run of runs) {
    for (const index of run.filterIndices) {
      const part = parts[index];
      if (part === undefined || part.kind !== 'filter') continue;
      removals.add(index);
      const normalized = normalizeQueryToken(part.raw);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      raws.push(part.raw);
    }
  }
  raws.push(cleanToken);

  const affected = new Set<number>();
  for (const index of removals) {
    const part = parts[index];
    if (part === undefined || part.kind !== 'filter') continue;
    part.dead = true;
    for (const killed of markAdjacentOps(parts, index)) {
      affected.add(matches.enclosing[killed] ?? -1);
    }
    affected.add(matches.enclosing[index] ?? -1);
  }

  let insertAt = 0;
  for (let i = 0; i < first.startIndex; i++) {
    const part = parts[i];
    if (part !== undefined && !part.dead) insertAt++;
  }

  const cleaned = sweepParts(parts, affected, true);
  const groupParts: QueryPart[] = [makeParenPart(true)];
  for (const raw of raws) {
    if (groupParts.length > 1) groupParts.push(makeOpPart('or'));
    groupParts.push(makeFilterPart(raw, false));
  }
  groupParts.push(makeParenPart(false));
  cleaned.splice(Math.min(insertAt, cleaned.length), 0, ...groupParts);
  return renderParts(cleaned);
}

function positiveOccurrences(parts: QueryPart[], needle: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (
      part !== undefined &&
      part.kind === 'filter' &&
      !part.negated &&
      normalizeQueryToken(part.raw) === needle
    ) {
      indices.push(i);
    }
  }
  return indices;
}

/* -------------------------------------------------------------------------- */
/* Removal cleanup                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Removes the given filter parts plus any `or`/`and`/`not` that losing them
 * would dangle, unwrapping or dropping paren groups left redundant. `parts` is
 * mutated; the live remainder is returned.
 */
function removeFilterParts(parts: QueryPart[], indices: ReadonlySet<number>): QueryPart[] {
  const matches = matchParens(parts);
  const affected = new Set<number>();
  for (const index of indices) {
    const part = parts[index];
    if (part === undefined || part.kind !== 'filter') continue;
    part.dead = true;
    for (const killed of markAdjacentOps(parts, index)) {
      affected.add(matches.enclosing[killed] ?? -1);
    }
    affected.add(matches.enclosing[index] ?? -1);
  }
  return sweepParts(parts, affected, true);
}

/**
 * Kills the nearest `or`/`and` the removed filter would dangle — preferring the
 * one after it, else the one before — plus a directly preceding `not`. Returns
 * the indices of killed operators.
 */
function markAdjacentOps(parts: QueryPart[], filterIndex: number): number[] {
  const killed: number[] = [];
  let removedJoiner = false;

  for (let i = filterIndex + 1; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined || part.dead) continue;
    if (part.kind === 'op' && part.op !== 'not') {
      part.dead = true;
      killed.push(i);
      removedJoiner = true;
    }
    break;
  }

  for (let i = filterIndex - 1; i >= 0; i--) {
    const part = parts[i];
    if (part === undefined || part.dead) continue;
    if (part.kind === 'op') {
      // A preceding `not` always goes with its filter; an or/and only goes
      // when no following joiner was removed (else both sides would strand).
      if (part.op === 'not' || !removedJoiner) {
        part.dead = true;
        killed.push(i);
      }
    }
    break;
  }

  return killed;
}

/**
 * Fixpoint cleanup after marking parts dead: drops emptied parentheses,
 * unwraps groups left holding a single term (when `unwrapSingles`), and kills
 * operators that no longer join two live terms — but only inside the affected
 * segments, so untouched user text is preserved verbatim.
 */
function sweepParts(
  parts: QueryPart[],
  affected: Set<number>,
  unwrapSingles: boolean,
): QueryPart[] {
  let changed = true;
  while (changed) {
    changed = false;
    const matches = matchParens(parts);

    const groups = [...affected].filter((index) => index >= 0).sort((a, b) => b - a);
    for (const openIdx of groups) {
      const open = parts[openIdx];
      if (open === undefined || open.dead || open.kind !== 'paren') continue;
      const closeIdx = matches.openToClose.get(openIdx);
      if (closeIdx === undefined) continue;

      let liveContent = 0;
      let liveOps = 0;
      for (let i = openIdx + 1; i < closeIdx; i++) {
        const part = parts[i];
        if (part === undefined || part.dead) continue;
        if (part.kind === 'op') liveOps++;
        else liveContent++;
      }
      if (liveContent > 1) continue;
      if (liveContent === 0 || (unwrapSingles && liveOps === 0)) {
        const close = parts[closeIdx];
        if (close !== undefined) close.dead = true;
        open.dead = true;
        affected.add(matches.enclosing[openIdx] ?? -1);
        changed = true;
      }
    }

    if (killDanglingOps(parts, matches, affected)) changed = true;
  }
  return parts.filter((part) => !part.dead);
}

/**
 * Kills `or`/`and` operators with no live term on both sides and `not`
 * operators whose target died — within affected segments only.
 */
function killDanglingOps(
  parts: QueryPart[],
  matches: ParenMatch,
  affected: ReadonlySet<number>,
): boolean {
  let changed = false;
  if (affected.has(-1) && cleanSegment(parts, matches, 0, parts.length)) changed = true;
  for (const [openIdx, closeIdx] of matches.openToClose) {
    if (affected.has(openIdx) && cleanSegment(parts, matches, openIdx + 1, closeIdx)) {
      changed = true;
    }
  }
  return changed;
}

/**
 * Walks one paren-group level (or the whole query at top level), treating
 * nested groups as single terms, and kills operators left dangling there.
 */
function cleanSegment(parts: QueryPart[], matches: ParenMatch, from: number, to: number): boolean {
  let changed = false;
  let seenContent = false;
  const pending: OpPart[] = [];

  const settle = (): void => {
    for (const op of pending) {
      if (!seenContent) {
        op.dead = true;
        changed = true;
      }
    }
    pending.length = 0;
  };

  for (let i = from; i < to; i++) {
    const part = parts[i];
    if (part === undefined || part.dead) continue;

    if (part.kind === 'paren') {
      if (part.open) {
        const closeIdx = matches.openToClose.get(i);
        if (closeIdx !== undefined) i = closeIdx;
      }
      settle();
      seenContent = true;
      continue;
    }

    if (part.kind === 'op') {
      if (part.op === 'not') {
        // `not` only negates the very next part; if that died, so does it.
        const successor = parts[i + 1];
        if (successor === undefined || successor.dead) {
          part.dead = true;
          changed = true;
        }
        continue;
      }
      pending.push(part);
      continue;
    }

    // A live filter or word is a term at this level.
    settle();
    seenContent = true;
  }

  for (const op of pending) {
    op.dead = true;
    changed = true;
  }
  return changed;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/** Renders parts back to a query string, hugging parens to their contents. */
function renderParts(parts: QueryPart[]): string {
  let out = '';
  let glueNext = false;
  for (const part of parts) {
    if (part.dead) continue;
    if (part.kind === 'paren') {
      if (!part.open) {
        out += ')';
        glueNext = false;
        continue;
      }
      if (out.length > 0 && !glueNext) out += ' ';
      out += part.negated ? '-(' : '(';
      glueNext = true;
      continue;
    }
    const text = part.kind === 'op' ? part.op : part.raw;
    if (out.length > 0 && !glueNext) out += ' ';
    out += text;
    glueNext = false;
  }
  return out;
}
