import type {
  FuzzySearchOptions,
  QueryPrecedence,
  SearchFilters,
  SearchIndexEntry,
  SearchResponse,
  SearchResultGroup,
  SearchResultItem,
  SortMode,
} from '../types/manifest';
import type { EntryDateRecord } from './entryDates';
import {
  CLASS_FILTER_OPTIONS,
  DAMAGE_FILTER_OPTIONS,
  TIER_FILTER_OPTIONS,
} from './enums';
import { parseHashInput } from './hash';
import { normalizeSourceLookup } from './sourceLookup';
import {
  ARTIFACT_PERKS_TABLE,
  TABLE_METADATA,
  canonicalTableName,
  getFriendlyTableName,
  getShortTableName,
  resolveTableAlias,
} from './tables';

export interface SearchFlags {
  redacted?: boolean;
  adept?: boolean;
  holofoil?: boolean;
  featured?: boolean;
  dummy?: boolean;
  enhanced?: boolean;
  hasLore?: boolean;
  hasIcon?: boolean;
  hasScreenshot?: boolean;
  hasWatermark?: boolean;
  hasFlavor?: boolean;
  hasCollectible?: boolean;
  artifact?: boolean;
  artifactPerk?: boolean;
  craftable?: boolean;
  catalyst?: boolean;
  ornament?: boolean;
}

export interface ParsedQuery {
  /** Lowercased free-text tokens. Quoted phrases stay together. */
  textTokens: string[];
  /** Lowercased tokens prefixed with "-" in the query. */
  negatedTokens: string[];
  /** Exact hashes, including multi-hash paste. */
  hashMatches: number[];
  /** Canonical table name from table:/t:. */
  tableFilter?: string;
  tierFilters: number[];
  damageFilters: number[];
  classFilters: number[];
  typeFilters: number[];
  ammoFilters: number[];
  slotFilters: number[];
  subtypeFilters: number[];
  /** Lowercased category name fragments from cat:/category:. */
  categoryTokens: string[];
  /** Raw season filter values (numeric, latest/current, or name fragment). */
  seasonFilters: string[];
  sourceTokens: string[];
  negatedSourceTokens: string[];
  traitTokens: string[];
  negatedTraitTokens: string[];
  flags: SearchFlags;
  /**
   * Boolean-expression AST for the search box query. When present it is the
   * single source of truth for query matching; the summary arrays above remain
   * populated for backwards compatibility and convenience.
   */
  ast?: QueryNode;
}

/**
 * Comparison operator applied to `season:` / `tier:` filter values. `=` is the
 * default equality/membership test; the rest compare the resolved scalar.
 */
export type ComparisonOp = '=' | '>' | '>=' | '<' | '<=';

/**
 * Boolean expression AST produced by `parseSearchQuery`. Atoms are the leaves
 * (one per filter token); `and`/`or`/`not` combine them with DIM-standard
 * Boolean precedence (NOT > AND > OR). Evaluation is deferred so the parser can
 * stay resilient while the user is mid-typing.
 */
export interface AndQueryNode {
  type: 'and';
  children: QueryNode[];
}

export interface OrQueryNode {
  type: 'or';
  children: QueryNode[];
}

export interface NotQueryNode {
  type: 'not';
  child: QueryNode;
}

export interface TableQueryAtom {
  type: 'atom';
  kind: 'table';
  table: string;
}
export interface TierQueryAtom {
  type: 'atom';
  kind: 'tier';
  value: number;
  op: ComparisonOp;
}
export interface DamageQueryAtom {
  type: 'atom';
  kind: 'damage';
  value: number;
}
export interface ClassQueryAtom {
  type: 'atom';
  kind: 'class';
  value: number;
}
export interface TypeQueryAtom {
  type: 'atom';
  kind: 'type';
  value: number;
}
export interface AmmoQueryAtom {
  type: 'atom';
  kind: 'ammo';
  value: number;
}
export interface SlotQueryAtom {
  type: 'atom';
  kind: 'slot';
  value: number;
}
export interface SubtypeQueryAtom {
  type: 'atom';
  kind: 'subtype';
  value: number;
}
export interface SeasonQueryAtom {
  type: 'atom';
  kind: 'season';
  value: string;
  op: ComparisonOp;
}
export interface SourceQueryAtom {
  type: 'atom';
  kind: 'source';
  value: string;
}
export interface TraitQueryAtom {
  type: 'atom';
  kind: 'trait';
  value: string;
}
export interface CategoryQueryAtom {
  type: 'atom';
  kind: 'category';
  value: string;
}
export interface FlagQueryAtom {
  type: 'atom';
  kind: 'flag';
  flag: FlagKey;
}
export interface HashQueryAtom {
  type: 'atom';
  kind: 'hash';
  value: number;
}
export interface TextQueryAtom {
  type: 'atom';
  kind: 'text';
  value: string;
}
export interface NeverQueryAtom {
  type: 'atom';
  kind: 'never';
}

export type QueryAtom =
  | TableQueryAtom
  | TierQueryAtom
  | DamageQueryAtom
  | ClassQueryAtom
  | TypeQueryAtom
  | AmmoQueryAtom
  | SlotQueryAtom
  | SubtypeQueryAtom
  | SeasonQueryAtom
  | SourceQueryAtom
  | TraitQueryAtom
  | CategoryQueryAtom
  | FlagQueryAtom
  | HashQueryAtom
  | TextQueryAtom
  | NeverQueryAtom;

export type QueryNode = AndQueryNode | OrQueryNode | NotQueryNode | QueryAtom;

/** Context resolved at search time that individual entries cannot encode. */
export interface SearchContext {
  /** Highest known season number, for `season:latest` / `season:current`. */
  latestSeason?: number;
  /** seasonNumber -> display name, for `season:<name fragment>`. */
  seasonNameMap?: Map<number, string>;
  /** Fallback names and aliases per season number, for `season:<name>`. */
  seasonAliases?: Readonly<Record<number, { fallbackName: string; aliases: readonly string[] }>>;
  /** normalized source key/alias -> canonical DIM source key, for `source:<name>`. */
  sourceAliasToKey?: Map<string, string>;
  /** Optional fuzzy-match settings for sitewide typo-tolerant search. */
  fuzzy?: FuzzySearchOptions;
  /** Loaded history dates keyed by the in-memory search-index entry. */
  entryDates?: Map<SearchIndexEntry, EntryDateRecord>;
}

type FlagKey = keyof SearchFlags;

const TIER_TOKENS: Readonly<Record<string, number>> = {
  unknown: 0,
  currency: 1,
  basic: 2,
  common: 2,
  white: 2,
  uncommon: 3,
  green: 3,
  rare: 4,
  blue: 4,
  legendary: 5,
  superior: 5,
  purple: 5,
  exotic: 6,
  yellow: 6,
};

const DAMAGE_TOKENS: Readonly<Record<string, number>> = {
  none: 0,
  kinetic: 1,
  arc: 2,
  solar: 3,
  thermal: 3,
  void: 4,
  raid: 5,
  stasis: 6,
  strand: 7,
};

const CLASS_TOKENS: Readonly<Record<string, number>> = {
  titan: 0,
  hunter: 1,
  warlock: 2,
  any: 3,
  unknown: 3,
};

const ITEM_TYPE_TOKENS: Readonly<Record<string, number>> = {
  weapon: 3,
  weapons: 3,
  armor: 2,
  armour: 2,
  mod: 19,
  mods: 19,
  shader: 20,
  shaders: 20,
  emblem: 14,
  emblems: 14,
  quest: 15,
  quests: 15,
  subclass: 16,
  subclasses: 16,
  ghost: 24,
  ghosts: 24,
  ship: 21,
  ships: 21,
  sparrow: 22,
  sparrows: 22,
  vehicle: 22,
  vehicles: 22,
  consumable: 9,
  consumables: 9,
  engram: 8,
  engrams: 8,
  bounty: 26,
  bounties: 26,
  emote: 23,
  emotes: 23,
  finisher: 29,
  finishers: 29,
  pattern: 30,
  patterns: 30,
};

const FLAG_TOKENS: Readonly<Record<string, FlagKey>> = {
  redacted: 'redacted',
  classified: 'redacted',
  adept: 'adept',
  holofoil: 'holofoil',
  featured: 'featured',
  enhanced: 'enhanced',
  dummy: 'dummy',
  lore: 'hasLore',
  haslore: 'hasLore',
  icon: 'hasIcon',
  hasicon: 'hasIcon',
  screenshot: 'hasScreenshot',
  hasscreenshot: 'hasScreenshot',
  watermark: 'hasWatermark',
  haswatermark: 'hasWatermark',
  flavor: 'hasFlavor',
  hasflavor: 'hasFlavor',
  collectible: 'hasCollectible',
  hascollectible: 'hasCollectible',
  artifact: 'artifact',
  artifactperk: 'artifactPerk',
  seasonalartifact: 'artifact',
  craftable: 'craftable',
  crafted: 'craftable',
  catalyst: 'catalyst',
  ornament: 'ornament',
};

const AMMO_TOKENS: Readonly<Record<string, number>> = {
  primary: 1,
  special: 2,
  heavy: 3,
};

const SLOT_TOKENS: Readonly<Record<string, number>> = {
  kinetic: 1498876634,
  energy: 2465295065,
  power: 953998645,
  heavy: 953998645,
  helmet: 3448274439,
  head: 3448274439,
  gauntlets: 3551918588,
  arms: 3551918588,
  chest: 14239492,
  legs: 20886954,
  boots: 20886954,
  class: 1585787867,
  classitem: 1585787867,
  ghost: 4023194814,
};

const SUBTYPE_TOKENS: Readonly<Record<string, number>> = {
  autorifle: 6,
  auto: 6,
  shotgun: 7,
  machinegun: 8,
  lmg: 8,
  handcannon: 9,
  hc: 9,
  rocket: 10,
  rl: 10,
  rocketlauncher: 10,
  fusion: 11,
  fusionrifle: 11,
  sniper: 12,
  sniperrifle: 12,
  pulse: 13,
  pulserifle: 13,
  scout: 14,
  scoutrifle: 14,
  sidearm: 17,
  sword: 18,
  linear: 22,
  lfr: 22,
  linearfusion: 22,
  linearfusionrifle: 22,
  grenade: 23,
  gl: 23,
  grenadelauncher: 23,
  smg: 24,
  submachinegun: 24,
  trace: 25,
  tracerifle: 25,
  bow: 31,
  glaive: 33,
};

type ValueAliasKind = 'tier' | 'damage' | 'class' | 'type' | 'ammo' | 'slot' | 'subtype';

interface ValueAlias {
  kind: ValueAliasKind;
  value: number;
}

/** Convenience `is:`/`has:` aliases that resolve to a scalar field match. */
const IS_VALUE_ALIASES: Readonly<Record<string, ValueAlias>> = {
  exotic: { kind: 'tier', value: 6 },
  legendary: { kind: 'tier', value: 5 },
  rare: { kind: 'tier', value: 4 },
  uncommon: { kind: 'tier', value: 3 },
  common: { kind: 'tier', value: 2 },
  basic: { kind: 'tier', value: 2 },
  weapon: { kind: 'type', value: 3 },
  armor: { kind: 'type', value: 2 },
  armour: { kind: 'type', value: 2 },
  mod: { kind: 'type', value: 19 },
  shader: { kind: 'type', value: 20 },
  emblem: { kind: 'type', value: 14 },
  quest: { kind: 'type', value: 15 },
  subclass: { kind: 'type', value: 16 },
  ship: { kind: 'type', value: 21 },
  sparrow: { kind: 'type', value: 22 },
  vehicle: { kind: 'type', value: 22 },
  consumable: { kind: 'type', value: 9 },
  engram: { kind: 'type', value: 8 },
  bounty: { kind: 'type', value: 26 },
  emote: { kind: 'type', value: 23 },
  finisher: { kind: 'type', value: 29 },
  pattern: { kind: 'type', value: 30 },
  kinetic: { kind: 'damage', value: 1 },
  arc: { kind: 'damage', value: 2 },
  solar: { kind: 'damage', value: 3 },
  void: { kind: 'damage', value: 4 },
  stasis: { kind: 'damage', value: 6 },
  strand: { kind: 'damage', value: 7 },
  primary: { kind: 'ammo', value: 1 },
  special: { kind: 'ammo', value: 2 },
  heavy: { kind: 'ammo', value: 3 },
  titan: { kind: 'class', value: 0 },
  hunter: { kind: 'class', value: 1 },
  warlock: { kind: 'class', value: 2 },
  // Weapon sub-types (DestinyItemSubType).
  autorifle: { kind: 'subtype', value: 6 },
  auto: { kind: 'subtype', value: 6 },
  shotgun: { kind: 'subtype', value: 7 },
  machinegun: { kind: 'subtype', value: 8 },
  lmg: { kind: 'subtype', value: 8 },
  handcannon: { kind: 'subtype', value: 9 },
  hc: { kind: 'subtype', value: 9 },
  rocket: { kind: 'subtype', value: 10 },
  rocketlauncher: { kind: 'subtype', value: 10 },
  rl: { kind: 'subtype', value: 10 },
  fusion: { kind: 'subtype', value: 11 },
  fusionrifle: { kind: 'subtype', value: 11 },
  sniper: { kind: 'subtype', value: 12 },
  sniperrifle: { kind: 'subtype', value: 12 },
  pulse: { kind: 'subtype', value: 13 },
  pulserifle: { kind: 'subtype', value: 13 },
  scout: { kind: 'subtype', value: 14 },
  scoutrifle: { kind: 'subtype', value: 14 },
  sidearm: { kind: 'subtype', value: 17 },
  sword: { kind: 'subtype', value: 18 },
  linear: { kind: 'subtype', value: 22 },
  lfr: { kind: 'subtype', value: 22 },
  linearfusion: { kind: 'subtype', value: 22 },
  linearfusionrifle: { kind: 'subtype', value: 22 },
  grenade: { kind: 'subtype', value: 23 },
  gl: { kind: 'subtype', value: 23 },
  grenadelauncher: { kind: 'subtype', value: 23 },
  smg: { kind: 'subtype', value: 24 },
  submachinegun: { kind: 'subtype', value: 24 },
  trace: { kind: 'subtype', value: 25 },
  tracerifle: { kind: 'subtype', value: 25 },
  bow: { kind: 'subtype', value: 31 },
  glaive: { kind: 'subtype', value: 33 },
  // Equipment slots (bucket hashes).
  kineticslot: { kind: 'slot', value: 1498876634 },
  energy: { kind: 'slot', value: 2465295065 },
  power: { kind: 'slot', value: 953998645 },
  helmet: { kind: 'slot', value: 3448274439 },
  head: { kind: 'slot', value: 3448274439 },
  gauntlets: { kind: 'slot', value: 3551918588 },
  arms: { kind: 'slot', value: 3551918588 },
  chest: { kind: 'slot', value: 14239492 },
  legs: { kind: 'slot', value: 20886954 },
  boots: { kind: 'slot', value: 20886954 },
  classitem: { kind: 'slot', value: 1585787867 },
  ghost: { kind: 'slot', value: 4023194814 },
};

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed.charAt(0);
    const last = trimmed.charAt(trimmed.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function pushUnique(target: string[], value: string): void {
  if (value && !target.includes(value)) target.push(value);
}

function pushUniqueNumber(target: number[], value: number): void {
  if (!target.includes(value)) target.push(value);
}

function normalizePhrase(value: string): string {
  return stripQuotes(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Split an optional leading comparison operator off a `season:`/`tier:` value.
 * `>=`/`<=` are checked before `>`/`<` so `>=` never parses as `>` + `=`.
 */
function parseComparisonOp(value: string): { op: ComparisonOp; rest: string } {
  const trimmed = value.trim();
  if (trimmed.startsWith('>=')) return { op: '>=', rest: trimmed.slice(2) };
  if (trimmed.startsWith('<=')) return { op: '<=', rest: trimmed.slice(2) };
  if (trimmed.startsWith('>')) return { op: '>', rest: trimmed.slice(1) };
  if (trimmed.startsWith('<')) return { op: '<', rest: trimmed.slice(1) };
  if (trimmed.startsWith('=')) return { op: '=', rest: trimmed.slice(1) };
  return { op: '=', rest: trimmed };
}

function compareValues(left: number, op: ComparisonOp, right: number): boolean {
  switch (op) {
    case '=':
      return left === right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
  }
}

function resolveTier(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = TIER_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) return numeric;
  const option = TIER_FILTER_OPTIONS.find((entry) => entry.label.toLowerCase() === token);
  return option ? option.value : null;
}

function resolveDamage(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = DAMAGE_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 7) return numeric;
  const option = DAMAGE_FILTER_OPTIONS.find((entry) => entry.label.toLowerCase() === token);
  return option ? option.value : null;
}

function resolveClass(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = CLASS_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 3) return numeric;
  const option = CLASS_FILTER_OPTIONS.find((entry) => entry.label.toLowerCase() === token);
  return option ? option.value : null;
}

function resolveItemType(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = ITEM_TYPE_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  return null;
}

function resolveAmmo(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = AMMO_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 3) return numeric;
  return null;
}

function resolveSlot(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = SLOT_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric >>> 0;
  return null;
}

function resolveSubtype(value: string): number | null {
  const token = value.trim().toLowerCase();
  const direct = SUBTYPE_TOKENS[token];
  if (direct !== undefined) return direct;
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  return null;
}

function looksLikeHashToken(value: string): boolean {
  const token = value.replace(/^#/, '');
  return /^[+-]?0x[0-9a-f]+$/i.test(token) || /^[+-]?\d{6,10}$/.test(token);
}

/** Known structured-filter operator keys. Any other `key:value` is free text. */
const OPERATOR_KEYS: ReadonlySet<string> = new Set([
  't',
  'table',
  'tier',
  'rarity',
  'damage',
  'element',
  'el',
  'dmg',
  'class',
  'type',
  'ammo',
  'slot',
  'subtype',
  'weapon',
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
]);

/* -------------------------------------------------------------------------- */
/* Tokenizer & recursive-descent Boolean parser                               */
/* -------------------------------------------------------------------------- */

type QueryToken =
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'quoted'; value: string }
  | { kind: 'word'; value: string };

/** Fold curly smart quotes back to ASCII before lexing. */
function normalizeSmartQuotes(raw: string): string {
  return raw
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'");
}

const isQuoteChar = (ch: string): boolean => ch === '"' || ch === "'";

/**
 * Read a `"..."` or `'...'` span starting at the opening quote. Handles the
 * `\"`, `\'` and `\\` escapes, and is tolerant of EOF (an unterminated quote
 * consumes cleanly to the end of input rather than throwing).
 */
function readQuoted(raw: string, start: number): { value: string; end: number } {
  const quote = raw.charAt(start);
  let index = start + 1;
  let value = '';
  while (index < raw.length) {
    const ch = raw.charAt(index);
    if (ch === '\\') {
      if (index + 1 < raw.length) {
        value += raw.charAt(index + 1);
        index += 2;
      } else {
        value += ch;
        index += 1;
      }
      continue;
    }
    if (ch === quote) {
      index += 1;
      break;
    }
    value += ch;
    index += 1;
  }
  return { value, end: index };
}

/**
 * Split a raw query into tokens. Parentheses are emitted as their own tokens,
 * quoted strings (single or double) stay together (folded into a `key:"value"`
 * word when they directly follow a colon), and commas/semicolons act as
 * separators so pasted hash lists keep working. Curly smart quotes are folded
 * to their ASCII equivalents first.
 */
function tokenizeQuery(raw: string): QueryToken[] {
  raw = normalizeSmartQuotes(raw);
  const tokens: QueryToken[] = [];
  const length = raw.length;
  let index = 0;
  while (index < length) {
    const ch = raw.charAt(index);
    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      index += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      index += 1;
      continue;
    }
    if (/\s/.test(ch) || ch === ',' || ch === ';') {
      index += 1;
      continue;
    }
    if (isQuoteChar(ch)) {
      const { value, end } = readQuoted(raw, index);
      tokens.push({ kind: 'quoted', value });
      index = end;
      continue;
    }
    let word = '';
    while (index < length) {
      const c = raw.charAt(index);
      if (/\s/.test(c) || c === '(' || c === ')' || c === ',' || c === ';') break;
      if (isQuoteChar(c)) {
        if (word.endsWith(':')) {
          const { value, end } = readQuoted(raw, index);
          word += `"${value}"`;
          index = end;
          continue;
        }
        break;
      }
      word += c;
      index += 1;
    }
    if (word) tokens.push({ kind: 'word', value: word });
  }
  return tokens;
}

/** An atom that never matches; emitted for a recognized-but-invalid value. */
const NEVER_ATOM: NeverQueryAtom = { type: 'atom', kind: 'never' };

/**
 * Resolve an `is:`/`has:`/`not:` value to an atom. Known flags and value
 * aliases map to their scalar match; anything unrecognized is `never` so an
 * invalid `is:` filter honestly returns zero matches instead of dropping out.
 */
function buildIsAtom(value: string): QueryAtom {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, '');
  const flagKey = FLAG_TOKENS[normalized];
  if (flagKey) return { type: 'atom', kind: 'flag', flag: flagKey };
  const alias = IS_VALUE_ALIASES[normalized];
  if (alias) {
    switch (alias.kind) {
      case 'tier':
        return { type: 'atom', kind: 'tier', value: alias.value, op: '=' };
      case 'damage':
        return { type: 'atom', kind: 'damage', value: alias.value };
      case 'class':
        return { type: 'atom', kind: 'class', value: alias.value };
      case 'type':
        return { type: 'atom', kind: 'type', value: alias.value };
      case 'ammo':
        return { type: 'atom', kind: 'ammo', value: alias.value };
      case 'slot':
        return { type: 'atom', kind: 'slot', value: alias.value };
      case 'subtype':
        return { type: 'atom', kind: 'subtype', value: alias.value };
    }
  }
  return NEVER_ATOM;
}

/** Build an operator atom from a known `key` and its already-stripped `value`. */
function buildOperatorAtom(
  key: string,
  value: string,
  availableTables: string[],
): QueryAtom {
  switch (key) {
    case 't':
    case 'table': {
      // Before the manifest has loaded, resolve against the known catalog so the
      // parsed query still carries a canonical table name.
      const scope = availableTables.length > 0 ? availableTables : Object.keys(TABLE_METADATA);
      const resolved = resolveTableAlias(value, scope);
      if (resolved) return { type: 'atom', kind: 'table', table: resolved };
      if (/^Destiny[A-Za-z0-9]+Definition$/.test(value)) {
        return { type: 'atom', kind: 'table', table: value };
      }
      return NEVER_ATOM;
    }
    case 'tier':
    case 'rarity': {
      const { op, rest } = parseComparisonOp(value);
      const tier = resolveTier(rest);
      return tier !== null ? { type: 'atom', kind: 'tier', value: tier, op } : NEVER_ATOM;
    }
    case 'damage':
    case 'element':
    case 'el':
    case 'dmg': {
      const damage = resolveDamage(value);
      return damage !== null ? { type: 'atom', kind: 'damage', value: damage } : NEVER_ATOM;
    }
    case 'class': {
      const classType = resolveClass(value);
      return classType !== null ? { type: 'atom', kind: 'class', value: classType } : NEVER_ATOM;
    }
    case 'type': {
      const itemType = resolveItemType(value);
      return itemType !== null ? { type: 'atom', kind: 'type', value: itemType } : NEVER_ATOM;
    }
    case 'ammo': {
      const ammo = resolveAmmo(value);
      return ammo !== null ? { type: 'atom', kind: 'ammo', value: ammo } : NEVER_ATOM;
    }
    case 'slot': {
      const slot = resolveSlot(value);
      return slot !== null ? { type: 'atom', kind: 'slot', value: slot } : NEVER_ATOM;
    }
    case 'subtype':
    case 'weapon': {
      const subtype = resolveSubtype(value);
      return subtype !== null ? { type: 'atom', kind: 'subtype', value: subtype } : NEVER_ATOM;
    }
    case 'season':
    case 's': {
      const { op, rest } = parseComparisonOp(value);
      const phrase = normalizePhrase(rest);
      return phrase ? { type: 'atom', kind: 'season', value: phrase, op } : NEVER_ATOM;
    }
    case 'source': {
      const phrase = normalizePhrase(value);
      return phrase ? { type: 'atom', kind: 'source', value: phrase } : NEVER_ATOM;
    }
    case 'trait': {
      const phrase = normalizePhrase(value);
      return phrase ? { type: 'atom', kind: 'trait', value: phrase } : NEVER_ATOM;
    }
    case 'cat':
    case 'category':
    case 'categories': {
      const phrase = normalizePhrase(value);
      return phrase ? { type: 'atom', kind: 'category', value: phrase } : NEVER_ATOM;
    }
    case 'is':
    case 'has': {
      return buildIsAtom(value);
    }
    case 'hash':
    case 'h': {
      const hash = parseHashInput(value);
      return hash !== null ? { type: 'atom', kind: 'hash', value: hash } : NEVER_ATOM;
    }
    default:
      return NEVER_ATOM;
  }
}

/** Turn a single word token (already negation-stripped) into a leaf node. */
function buildAtomFromWord(body: string, availableTables: string[]): QueryNode | null {
  const colon = body.indexOf(':');
  if (colon > 0) {
    const key = body.slice(0, colon).trim().toLowerCase();
    const value = stripQuotes(body.slice(colon + 1)).trim();
    if (!value) return null;
    // `not:X` is shorthand for `-is:X`.
    if (key === 'not') {
      return { type: 'not', child: buildIsAtom(value) };
    }
    if (OPERATOR_KEYS.has(key)) {
      return buildOperatorAtom(key, value, availableTables);
    }
    // Unknown prefix: treat the whole token as free text.
    const phrase = normalizePhrase(body);
    return phrase ? { type: 'atom', kind: 'text', value: phrase } : null;
  }
  const phrase = normalizePhrase(body);
  if (!phrase) return null;
  return { type: 'atom', kind: 'text', value: phrase };
}

/**
 * Recursive-descent parser implementing `NOT > AND > OR` precedence (parentheses
 * highest), with implicit AND by adjacency. Always returns a best-effort AST:
 * dangling operators, empty groups, stray parens and malformed tokens are
 * ignored rather than throwing, so typing mid-query never crashes or zeroes out.
 */
/**
 * Recursive-descent parser implementing Boolean precedence with parentheses
 * highest. Two precedence modes are supported (see `QueryPrecedence`):
 *  - `dim`:      NOT > explicit `and` > `or` > implicit whitespace AND
 *  - `standard`: NOT > AND (whitespace + `and`) > OR
 * Always returns a best-effort AST: dangling operators, empty groups, stray
 * parens and malformed tokens are ignored rather than throwing, so typing
 * mid-query never crashes or zeroes out.
 */
function parseQueryAst(
  raw: string,
  availableTables: string[],
  precedence: QueryPrecedence,
): QueryNode | null {
  const tokens = tokenizeQuery(raw);
  let pos = 0;
  let parenDepth = 0;

  const peek = (offset = 0): QueryToken | undefined => tokens[pos + offset];
  const consume = (): QueryToken | undefined => {
    const token = tokens[pos];
    if (token !== undefined) pos += 1;
    return token;
  };
  const isWord = (token: QueryToken | undefined, word: string): boolean =>
    token?.kind === 'word' && token.value.toLowerCase() === word;

  // Skip dangling `and` keywords and stray (unmatched) closing parens. Used at
  // the AND level where `or` must still delimit the group.
  function skipAndNoise(): void {
    for (;;) {
      const token = peek();
      if (token === undefined) return;
      if (token.kind === 'rparen' && parenDepth === 0) {
        consume();
        continue;
      }
      if (isWord(token, 'and')) {
        consume();
        continue;
      }
      return;
    }
  }

  // Skip any dangling Boolean keyword and stray closing parens. Used at the
  // loosest (implicit-AND) level.
  function skipAnyNoise(): void {
    for (;;) {
      const token = peek();
      if (token === undefined) return;
      if (token.kind === 'rparen' && parenDepth === 0) {
        consume();
        continue;
      }
      if (isWord(token, 'and') || isWord(token, 'or')) {
        consume();
        continue;
      }
      return;
    }
  }

  function parseUnary(group: () => QueryNode | null): QueryNode | null {
    const token = peek();
    if (token === undefined) return null;

    if (token.kind === 'lparen') {
      consume();
      parenDepth += 1;
      const inner = group();
      if (peek()?.kind === 'rparen') {
        consume();
        parenDepth -= 1;
      }
      return inner;
    }

    if (token.kind === 'rparen') return null;

    if (token.kind === 'quoted') {
      consume();
      // The tokenizer already removed the delimiters and unescaped the content.
      const phrase = token.value.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!phrase) return null;
      return { type: 'atom', kind: 'text', value: phrase };
    }

    const raw = token.value;
    const lower = raw.toLowerCase();

    if (lower === 'or' || lower === 'and') return null;

    if (lower === 'not') {
      consume();
      const child = parseUnary(group);
      if (child === null) return null;
      return child.type === 'not' ? child.child : { type: 'not', child };
    }

    if (raw === '-') {
      consume();
      const child = parseUnary(group);
      if (child === null) return null;
      return child.type === 'not' ? child.child : { type: 'not', child };
    }

    // A signed 32-bit hash token (e.g. -1368098261) is a positive hash, not a
    // negation. Check this before interpreting a leading `-` as NOT.
    if (looksLikeHashToken(raw)) {
      const hash = parseHashInput(raw);
      if (hash !== null) {
        consume();
        return { type: 'atom', kind: 'hash', value: hash };
      }
    }

    let negated = false;
    let body = raw;
    if (raw.startsWith('-') && raw.length > 1) {
      negated = true;
      body = raw.slice(1);
    }

    const atom = buildAtomFromWord(body, availableTables);
    consume();
    if (atom === null) return null;
    if (negated) {
      return atom.type === 'not' ? atom.child : { type: 'not', child: atom };
    }
    return atom;
  }

  // --- DIM precedence: NOT > explicit `and` > `or` > implicit AND -----------
  function parseExplicitAnd(): QueryNode | null {
    const children: QueryNode[] = [];
    for (;;) {
      while (isWord(peek(), 'and')) consume(); // skip dangling leading `and`
      const unary = parseUnary(parseImplicitAnd);
      if (unary !== null) children.push(unary);
      if (isWord(peek(), 'and')) {
        consume();
        continue;
      }
      break;
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  function parseOrDim(): QueryNode | null {
    const children: QueryNode[] = [];
    for (;;) {
      while (isWord(peek(), 'or')) consume(); // skip dangling leading `or`
      const andNode = parseExplicitAnd();
      if (andNode !== null) children.push(andNode);
      if (isWord(peek(), 'or')) {
        consume();
        continue;
      }
      break;
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  function parseImplicitAnd(): QueryNode | null {
    const children: QueryNode[] = [];
    for (;;) {
      skipAnyNoise();
      const token = peek();
      if (token === undefined) break;
      if (token.kind === 'rparen') break; // matched close; bubble up to the group
      const orNode = parseOrDim();
      if (orNode === null) break;
      children.push(orNode);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  // --- Standard precedence: NOT > AND (whitespace + `and`) > OR -------------
  function parseAndStandard(): QueryNode | null {
    const children: QueryNode[] = [];
    for (;;) {
      skipAndNoise();
      const token = peek();
      if (token === undefined) break;
      if (token.kind === 'rparen') break;
      if (isWord(token, 'or')) break;
      const unary = parseUnary(parseOrStandard);
      if (unary !== null) children.push(unary);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  function parseOrStandard(): QueryNode | null {
    const children: QueryNode[] = [];
    for (;;) {
      while (isWord(peek(), 'or')) consume();
      const andNode = parseAndStandard();
      if (andNode !== null) children.push(andNode);
      if (isWord(peek(), 'or')) {
        consume();
        continue;
      }
      break;
    }
    if (children.length === 0) return null;
    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  return precedence === 'dim' ? parseImplicitAnd() : parseOrStandard();
}

/* -------------------------------------------------------------------------- */
/* Summary derivation (backwards-compatible flat arrays)                      */
/* -------------------------------------------------------------------------- */

interface SummaryAccumulator {
  textTokens: string[];
  negatedTokens: string[];
  hashMatches: number[];
  tableFilterCandidates: string[];
  tierFilters: number[];
  damageFilters: number[];
  classFilters: number[];
  typeFilters: number[];
  ammoFilters: number[];
  slotFilters: number[];
  subtypeFilters: number[];
  categoryTokens: string[];
  seasonFilters: string[];
  sourceTokens: string[];
  negatedSourceTokens: string[];
  traitTokens: string[];
  negatedTraitTokens: string[];
  flags: SearchFlags;
  hasOr: boolean;
}

function walkSummary(node: QueryNode, negated: boolean, acc: SummaryAccumulator): void {
  switch (node.type) {
    case 'and':
      for (const child of node.children) walkSummary(child, negated, acc);
      return;
    case 'or':
      acc.hasOr = true;
      for (const child of node.children) walkSummary(child, negated, acc);
      return;
    case 'not':
      walkSummary(node.child, !negated, acc);
      return;
    case 'atom':
      walkAtomSummary(node, negated, acc);
      return;
  }
}

function walkAtomSummary(atom: QueryAtom, negated: boolean, acc: SummaryAccumulator): void {
  switch (atom.kind) {
    case 'text':
      pushUnique(negated ? acc.negatedTokens : acc.textTokens, atom.value);
      return;
    case 'hash':
      if (!negated) pushUniqueNumber(acc.hashMatches, atom.value);
      return;
    case 'table':
      if (!negated) pushUnique(acc.tableFilterCandidates, atom.table);
      return;
    case 'tier':
      if (!negated && atom.op === '=') pushUniqueNumber(acc.tierFilters, atom.value);
      return;
    case 'damage':
      if (!negated) pushUniqueNumber(acc.damageFilters, atom.value);
      return;
    case 'class':
      if (!negated) pushUniqueNumber(acc.classFilters, atom.value);
      return;
    case 'type':
      if (!negated) pushUniqueNumber(acc.typeFilters, atom.value);
      return;
    case 'ammo':
      if (!negated) pushUniqueNumber(acc.ammoFilters, atom.value);
      return;
    case 'slot':
      if (!negated) pushUniqueNumber(acc.slotFilters, atom.value);
      return;
    case 'subtype':
      if (!negated) pushUniqueNumber(acc.subtypeFilters, atom.value);
      return;
    case 'season':
      if (!negated && atom.op === '=') pushUnique(acc.seasonFilters, atom.value);
      return;
    case 'source':
      pushUnique(negated ? acc.negatedSourceTokens : acc.sourceTokens, atom.value);
      return;
    case 'trait':
      pushUnique(negated ? acc.negatedTraitTokens : acc.traitTokens, atom.value);
      return;
    case 'category':
      if (!negated) pushUnique(acc.categoryTokens, atom.value);
      return;
    case 'flag':
      acc.flags[atom.flag] = !negated;
      return;
    case 'never':
      return;
  }
}

/**
 * Parse a search box query into structured filters and a Boolean expression
 * AST. Unsupported prefixes are treated as plain text so nothing typed by the
 * user silently disappears.
 */
export function parseSearchQuery(
  raw: string,
  availableTables: string[],
  precedence: QueryPrecedence = 'dim',
): ParsedQuery {
  const ast = parseQueryAst(raw, availableTables, precedence);

  const acc: SummaryAccumulator = {
    textTokens: [],
    negatedTokens: [],
    hashMatches: [],
    tableFilterCandidates: [],
    tierFilters: [],
    damageFilters: [],
    classFilters: [],
    typeFilters: [],
    ammoFilters: [],
    slotFilters: [],
    subtypeFilters: [],
    categoryTokens: [],
    seasonFilters: [],
    sourceTokens: [],
    negatedSourceTokens: [],
    traitTokens: [],
    negatedTraitTokens: [],
    flags: {},
    hasOr: false,
  };

  if (ast !== null) walkSummary(ast, false, acc);

  const parsed: ParsedQuery = {
    textTokens: acc.textTokens,
    negatedTokens: acc.negatedTokens,
    hashMatches: acc.hashMatches,
    tierFilters: acc.tierFilters,
    damageFilters: acc.damageFilters,
    classFilters: acc.classFilters,
    typeFilters: acc.typeFilters,
    ammoFilters: acc.ammoFilters,
    slotFilters: acc.slotFilters,
    subtypeFilters: acc.subtypeFilters,
    categoryTokens: acc.categoryTokens,
    seasonFilters: acc.seasonFilters,
    sourceTokens: acc.sourceTokens,
    negatedSourceTokens: acc.negatedSourceTokens,
    traitTokens: acc.traitTokens,
    negatedTraitTokens: acc.negatedTraitTokens,
    flags: acc.flags,
  };
  if (ast !== null) parsed.ast = ast;
  if (acc.tableFilterCandidates.length === 1 && !acc.hasOr) {
    parsed.tableFilter = acc.tableFilterCandidates[0];
  }
  return parsed;
}

function hasPositiveTableScope(ast: QueryNode | null): boolean {
  if (ast === null) return false;
  const visit = (node: QueryNode, negated: boolean): boolean => {
    switch (node.type) {
      case 'and':
      case 'or':
        return node.children.some((child) => visit(child, negated));
      case 'not':
        return visit(node.child, !negated);
      case 'atom':
        return node.kind === 'table' && !negated;
    }
  };
  return visit(ast, false);
}

/** True when the query contains a non-negated `table:` / `t:` atom. */
export function hasPositiveTableScopeInQuery(query: string): boolean {
  const availableTables = [...Object.keys(TABLE_METADATA), ARTIFACT_PERKS_TABLE];
  return hasPositiveTableScope(parseSearchQuery(query, availableTables).ast ?? null);
}

/**
 * Apply the backward-compatible unnamed flag and table-scope-aware default.
 * The UI and worker share this helper so their interpretation cannot drift.
 */
export function isUnnamedIncluded(
  filters: Pick<SearchFilters, 'table' | 'includeUnnamed' | 'unnamedMode'>,
  query: string,
): boolean {
  const mode = filters.unnamedMode ?? 'auto';
  const tableScoped = filters.table !== 'all' && filters.table !== '';
  return (
    mode === 'always' ||
    (mode !== 'never' &&
      (filters.includeUnnamed || tableScoped || hasPositiveTableScopeInQuery(query)))
  );
}

/* -------------------------------------------------------------------------- */
/* Ranking and filtering                                                      */
/* -------------------------------------------------------------------------- */

interface ScoredEntry {
  entry: SearchIndexEntry;
  score: number;
  /** Position in the original scan, used as a stable tie-breaker. */
  order: number;
}

type ScoredComparator = (a: ScoredEntry, b: ScoredEntry) => number;

export function sortUsesDates(sort: SortMode): boolean {
  return (
    sort === 'release-desc' ||
    sort === 'release-asc' ||
    sort === 'update-desc' ||
    sort === 'update-asc'
  );
}

/**
 * Build the ordering predicate for a sort mode once per search instead of
 * switching inside every comparison. The final `order` fallback reproduces
 * `Array.prototype.sort`'s stability, so bounded top-K selection returns the
 * exact same slice as a full sort.
 */
function scoredComparator(sort: SortMode, entryDates?: Map<SearchIndexEntry, EntryDateRecord>): ScoredComparator {
  let base: ScoredComparator;
  switch (sort) {
    case 'name-asc':
      base = (a, b) => compareNames(a.entry, b.entry) || b.score - a.score;
      break;
    case 'name-desc':
      base = (a, b) => compareNames(b.entry, a.entry) || b.score - a.score;
      break;
    case 'hash-asc':
      base = (a, b) => a.entry.hash - b.entry.hash;
      break;
    case 'hash-desc':
      base = (a, b) => b.entry.hash - a.entry.hash;
      break;
    case 'index-desc':
      base = (a, b) => {
        const indexDelta = (b.entry.index ?? -1) - (a.entry.index ?? -1);
        return indexDelta || compareNames(a.entry, b.entry);
      };
      break;
    case 'release-desc':
    case 'release-asc':
    case 'update-desc':
    case 'update-asc': {
      if (!entryDates) {
        base = (a, b) =>
          b.score - a.score || compareNames(a.entry, b.entry) || a.entry.hash - b.entry.hash;
      } else {
        const descending = sort.endsWith('desc');
        const versionField = sort.startsWith('release')
          ? 'firstVersionIndex'
          : 'lastVersionIndex';
        const missingRank = descending ? -1 : Number.MAX_SAFE_INTEGER;
        base = (a, b) => {
          const aRecord = entryDates.get(a.entry);
          const bRecord = entryDates.get(b.entry);
          const aVersion = aRecord?.[versionField] ?? -1;
          const bVersion = bRecord?.[versionField] ?? -1;
          const aRank = aVersion < 0 ? missingRank : aVersion;
          const bRank = bVersion < 0 ? missingRank : bVersion;
          return (
            (descending ? bRank - aRank : aRank - bRank) ||
            compareNames(a.entry, b.entry) ||
            a.entry.hash - b.entry.hash
          );
        };
      }
      break;
    }
    case 'relevance':
    default:
      base = (a, b) =>
        b.score - a.score || compareNames(a.entry, b.entry) || a.entry.hash - b.entry.hash;
      break;
  }
  return (a, b) => base(a, b) || a.order - b.order;
}

/**
 * Bounded top-K accumulator with the current worst retained candidate at
 * index 0 (a max-heap under `compare`, where negative means "better").
 *
 * The scan reuses a single candidate object, so candidates that cannot beat
 * the root are rejected without any allocation, and retained slots are
 * overwritten in place once the heap is full. Total allocation is O(limit)
 * instead of O(matches).
 */
class ScoredEntryTopK {
  private readonly heap: ScoredEntry[] = [];

  constructor(
    private readonly limit: number,
    private readonly compare: ScoredComparator,
  ) {}

  /** Offer a candidate; `candidate` may be reused by the caller afterwards. */
  consider(candidate: ScoredEntry): void {
    if (this.limit <= 0) return;
    if (this.heap.length < this.limit) {
      this.heap.push({
        entry: candidate.entry,
        score: candidate.score,
        order: candidate.order,
      });
      if (this.heap.length === this.limit) this.heapify();
      return;
    }
    const worst = this.heap[0]!;
    if (this.compare(candidate, worst) >= 0) return;
    worst.entry = candidate.entry;
    worst.score = candidate.score;
    worst.order = candidate.order;
    this.siftDown(0);
  }

  /** The retained candidates sorted best-first. Consumes the heap. */
  toSortedArray(): ScoredEntry[] {
    return this.heap.sort(this.compare);
  }

  private heapify(): void {
    for (let index = (this.heap.length >> 1) - 1; index >= 0; index -= 1) {
      this.siftDown(index);
    }
  }

  private siftDown(start: number): void {
    const heap = this.heap;
    const size = heap.length;
    let index = start;
    for (;;) {
      const left = index * 2 + 1;
      if (left >= size) return;
      const right = left + 1;
      let worse = left;
      if (right < size && this.compare(heap[right]!, heap[left]!) > 0) worse = right;
      if (this.compare(heap[worse]!, heap[index]!) <= 0) return;
      const swap = heap[index]!;
      heap[index] = heap[worse]!;
      heap[worse] = swap;
      index = worse;
    }
  }
}

function isWordCharCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 97 && code <= 122)
  );
}

function nameSubstringScore(haystack: string, needle: string): number {
  let index = haystack.indexOf(needle);
  if (index === -1) return 0;
  while (index !== -1) {
    const afterIndex = index + needle.length;
    const beforeOk = index === 0 || !isWordCharCode(haystack.charCodeAt(index - 1));
    const afterOk = afterIndex >= haystack.length || !isWordCharCode(haystack.charCodeAt(afterIndex));
    if (beforeOk && afterOk) return 200;
    index = haystack.indexOf(needle, index + 1);
  }
  return 100;
}

/* -------------------------------------------------------------------------- */
/* Bounded Optimal String Alignment (Damerau-Levenshtein)                      */
/* -------------------------------------------------------------------------- */

/**
 * Small pre-allocated row buffers reused by every edit-distance comparison so
 * scanning the (277k+) entry index never allocates per-call arrays. Long words
 * that exceed the buffer fall back to a one-off allocation.
 */
const EDIT_BUFFER_COLS = 256;
const editBufA = new Int32Array(EDIT_BUFFER_COLS);
const editBufB = new Int32Array(EDIT_BUFFER_COLS);
const editBufC = new Int32Array(EDIT_BUFFER_COLS);

/**
 * Bounded Optimal String Alignment distance over `a[aStart..aEnd)` versus `b`.
 * Supports insertions, deletions, substitutions AND adjacent transpositions
 * (the last is crucial for real typos like `Sunhsot` -> `Sunshot`).
 *
 * Early exits:
 *  - length delta > maxDist
 *  - every cell in a row exceeding maxDist
 * Values above `maxDist` are reported as `maxDist + 1`.
 */
function boundedEditDistanceRange(
  a: string,
  aStart: number,
  aEnd: number,
  b: string,
  maxDist: number,
): number {
  const m = aEnd - aStart;
  const n = b.length;

  if (Math.abs(m - n) > maxDist) return maxDist + 1;
  if (maxDist <= 0) {
    return a.slice(aStart, aEnd) === b ? 0 : maxDist + 1;
  }
  if (m === 0) return n <= maxDist ? n : maxDist + 1;
  if (n === 0) return m <= maxDist ? m : maxDist + 1;

  const cols = n + 1;
  let p2: Int32Array;
  let p1: Int32Array;
  let cur: Int32Array;
  if (cols <= EDIT_BUFFER_COLS) {
    p2 = editBufA;
    p1 = editBufB;
    cur = editBufC;
  } else {
    p2 = new Int32Array(cols);
    p1 = new Int32Array(cols);
    cur = new Int32Array(cols);
  }

  // Row 0: distance from the empty prefix of `a` to each prefix of `b`.
  for (let j = 0; j <= n; j++) p1[j] = j;

  for (let i = 1; i <= m; i++) {
    const ai = a.charCodeAt(aStart + i - 1);
    cur[0] = i;
    let rowMin = i;

    for (let j = 1; j <= n; j++) {
      const bj = b.charCodeAt(j - 1);
      const cost = ai === bj ? 0 : 1;

      let min = p1[j]! + 1; // deletion
      const ins = cur[j - 1]! + 1; // insertion
      if (ins < min) min = ins;
      const sub = p1[j - 1]! + cost; // substitution
      if (sub < min) min = sub;

      // Adjacent transposition: swapping a[i-2] and a[i-1] to match b[j-2], b[j-1].
      if (
        i >= 2 &&
        j >= 2 &&
        ai === b.charCodeAt(j - 2) &&
        a.charCodeAt(aStart + i - 2) === bj
      ) {
        const trans = p2[j - 2]! + 1;
        if (trans < min) min = trans;
      }

      cur[j] = min;
      if (min < rowMin) rowMin = min;
    }

    if (rowMin > maxDist) return maxDist + 1;

    const tmp = p2;
    p2 = p1;
    p1 = cur;
    cur = tmp;
  }

  return p1[n]!;
}

/**
 * Fast, allocation-light bounded Optimal String Alignment (Damerau-Levenshtein)
 * distance. Returns a value `<= maxDist` on a close match, or `maxDist + 1`
 * when the strings are farther apart than the tolerance.
 */
export function boundedEditDistance(a: string, b: string, maxDist: number): number {
  return boundedEditDistanceRange(a, 0, a.length, b, maxDist);
}

/**
 * Score an entry against a single token using typo-tolerant fuzzy matching.
 * Returns `0` when no word/name is within tolerance. Any positive score here is
 * kept strictly below the exact-substring score of `100`, so exact/substring
 * matches always outrank fuzzy ones.
 */
export function fuzzyMatchScore(
  entry: SearchIndexEntry,
  token: string,
  threshold: number,
): number {
  if (token.length < 3 || threshold <= 0) return 0;
  const name = entry.nameLower;
  if (!name) return 0;

  const maxDist = Math.min(4, Math.max(1, Math.floor(token.length * threshold)));
  const tokenFirst = token.charCodeAt(0);

  let bestDist = maxDist + 1;
  let bestFirstMatches = false;

  // 1. Full name (also covers multi-word quoted tokens directly).
  if (Math.abs(name.length - token.length) <= maxDist) {
    const d = boundedEditDistanceRange(name, 0, name.length, token, maxDist);
    if (d < bestDist) {
      bestDist = d;
      bestFirstMatches = name.charCodeAt(0) === tokenFirst;
    }
  }

  // 2. Individual alphanumeric words in the name. The apostrophe in a
  //    contraction like `izanagi's` acts as a word boundary, so `burdn` still
  //    matches the trailing `burden`. Only single-word tokens are scanned this
  //    way; multi-word tokens are handled by the full-name comparison above.
  if (token.indexOf(' ') === -1) {
    let wordStart = 0;
    for (let i = 0; i <= name.length; i++) {
      const ch = i < name.length ? name.charCodeAt(i) : -1;
      const isAlnum = (ch >= 48 && ch <= 57) || (ch >= 97 && ch <= 122);
      if (isAlnum) continue;
      if (i > wordStart) {
        const wordLen = i - wordStart;
        if (Math.abs(wordLen - token.length) <= maxDist) {
          const d = boundedEditDistanceRange(name, wordStart, i, token, maxDist);
          if (d < bestDist) {
            bestDist = d;
            bestFirstMatches = name.charCodeAt(wordStart) === tokenFirst;
          }
        }
      }
      wordStart = i + 1;
    }
  }

  if (bestDist > maxDist) return 0;

  let score = Math.round(85 * (1 - bestDist / Math.max(token.length, 1)));
  if (score < 10) score = 10;
  if (bestFirstMatches) score += 8;
  return score;
}

/**
 * Cache of the last lowercased parent artifact name. Artifact names repeat
 * across every perk of the same artifact, so this removes thousands of
 * per-entry `toLowerCase()` allocations during a scan without changing results.
 */
let cachedParentArtifactName: string | undefined;
let cachedParentArtifactLower = '';

function parentArtifactNameLower(name: string): string {
  if (name !== cachedParentArtifactName) {
    cachedParentArtifactName = name;
    cachedParentArtifactLower = name.toLowerCase();
  }
  return cachedParentArtifactLower;
}

function scoreToken(entry: SearchIndexEntry, token: string, context?: SearchContext): number {
  if (!token) return 0;
  if (entry.nameLower === token) return 500;
  if (entry.nameLower.startsWith(token)) return 300;
  const nameScore = nameSubstringScore(entry.nameLower, token);
  if (nameScore > 0) return nameScore;
  if (entry.subtitleLower.includes(token)) return 50;
  if (entry.parentArtifactName && parentArtifactNameLower(entry.parentArtifactName).includes(token)) {
    return 40;
  }
  if (entry.descLower.includes(token)) return 20;
  if (context?.fuzzy?.enabled) {
    return fuzzyMatchScore(entry, token, context.fuzzy.threshold);
  }
  return 0;
}

interface TextSearchIndex {
  entryCount: number;
  words: string[];
  wordPostings: Uint32Array[];
  wordTrigramPostings: Map<number, Uint32Array>;
  tablePostings: Map<string, Uint32Array>;
  tableCounts: Map<string, { count: number; unnamedCount: number }>;
  unnamedCount: number;
}

/**
 * The index is tied to the entries array and is only created for substantial
 * indexes, after the first eligible search. Worker mutations explicitly
 * invalidate it; the length check also handles arrays that grow in place.
 */
const textSearchIndexes = new WeakMap<SearchIndexEntry[], TextSearchIndex>();
const textSearchBuilds = new WeakMap<SearchIndexEntry[], Promise<void>>();
const textSearchVersions = new WeakMap<SearchIndexEntry[], number>();
const MIN_TEXT_INDEX_ENTRIES = 128;
const TEXT_INDEX_BUILD_BATCH_ENTRIES = 8192;

function yieldTextIndexBuild(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Pack the low byte of each UTF-16 code unit into a number. Non-ASCII text can
 * collide with another trigram, which only widens the candidate set; the final
 * exact scorer still decides matches, so no valid result can be omitted.
 */
function numericTrigramAt(text: string, index: number): number {
  return (
    ((text.charCodeAt(index) & 0xff) << 16) |
    ((text.charCodeAt(index + 1) & 0xff) << 8) |
    (text.charCodeAt(index + 2) & 0xff)
  );
}

function addTextTrigrams(text: string | undefined, trigrams: Set<number>): void {
  if (!text || text.length < 3) return;
  let trigram =
    ((text.charCodeAt(0) & 0xff) << 16) |
    ((text.charCodeAt(1) & 0xff) << 8) |
    (text.charCodeAt(2) & 0xff);
  for (let index = 0; index <= text.length - 3; index += 1) {
    trigrams.add(trigram);
    if (index + 3 < text.length) {
      trigram = ((trigram << 8) & 0xffff00) | (text.charCodeAt(index + 3) & 0xff);
    }
  }
}

function addTextWords(
  text: string | undefined,
  entryIndex: number,
  wordsById: Map<string, number>,
  words: string[],
  postings: Array<number | number[]>,
  seenWords: Set<string>,
): void {
  if (!text) return;
  let wordStart = -1;
  let wordHasLetter = false;
  for (let index = 0; index <= text.length; index += 1) {
    const code = index < text.length ? text.charCodeAt(index) : -1;
    if (isWordCharCode(code)) {
      if (wordStart === -1) wordStart = index;
      if (code >= 97 && code <= 122) wordHasLetter = true;
      continue;
    }
    if (wordStart === -1) continue;
    if (wordHasLetter) {
      const word = text.slice(wordStart, index);
      if (!seenWords.has(word)) {
        seenWords.add(word);
        let wordId = wordsById.get(word);
        if (wordId === undefined) {
          wordId = words.length;
          wordsById.set(word, wordId);
          words.push(word);
          postings.push(entryIndex);
        } else {
          const existing = postings[wordId]!;
          if (typeof existing === 'number') postings[wordId] = [existing, entryIndex];
          else existing.push(entryIndex);
        }
      }
    }
    wordStart = -1;
    wordHasLetter = false;
  }
}

async function buildTextSearchIndex(
  entries: SearchIndexEntry[],
  isCurrent: () => boolean,
): Promise<TextSearchIndex | undefined> {
  const wordsById = new Map<string, number>();
  const words: string[] = [];
  const wordPostingLists: Array<number | number[]> = [];
  const tableCounts = new Map<string, { count: number; unnamedCount: number }>();
  const tablePostingLists = new Map<string, number[]>();
  const seenWords = new Set<string>();
  let unnamedCount = 0;

  for (let start = 0; start < entries.length; start += TEXT_INDEX_BUILD_BATCH_ENTRIES) {
    const end = Math.min(entries.length, start + TEXT_INDEX_BUILD_BATCH_ENTRIES);
    for (let entryIndex = start; entryIndex < end; entryIndex += 1) {
      const entry = entries[entryIndex]!;
      if (!entry.name) unnamedCount += 1;
      const table = cachedTableKey(entry.table);
      let tableCount = tableCounts.get(table);
      if (!tableCount) {
        tableCount = { count: 0, unnamedCount: 0 };
        tableCounts.set(table, tableCount);
        tablePostingLists.set(table, []);
      }
      tableCount.count += 1;
      tablePostingLists.get(table)!.push(entryIndex);
      if (!entry.name) tableCount.unnamedCount += 1;
      if (entry.isArtifactPerk === true) {
        let artifactCount = tableCounts.get(ARTIFACT_PERKS_KEY);
        if (!artifactCount) {
          artifactCount = { count: 0, unnamedCount: 0 };
          tableCounts.set(ARTIFACT_PERKS_KEY, artifactCount);
          tablePostingLists.set(ARTIFACT_PERKS_KEY, []);
        }
        artifactCount.count += 1;
        tablePostingLists.get(ARTIFACT_PERKS_KEY)!.push(entryIndex);
        if (!entry.name) artifactCount.unnamedCount += 1;
      }
      seenWords.clear();
      addTextWords(entry.nameLower, entryIndex, wordsById, words, wordPostingLists, seenWords);
      addTextWords(entry.subtitleLower, entryIndex, wordsById, words, wordPostingLists, seenWords);
      addTextWords(entry.descLower, entryIndex, wordsById, words, wordPostingLists, seenWords);
      if (entry.parentArtifactName) {
        addTextWords(
          parentArtifactNameLower(entry.parentArtifactName),
          entryIndex,
          wordsById,
          words,
          wordPostingLists,
          seenWords,
        );
      }
    }
    if (end < entries.length) await yieldTextIndexBuild();
    if (!isCurrent()) return undefined;
  }

  const wordTrigramLists = new Map<number, number[]>();
  const wordTrigrams = new Set<number>();
  for (let start = 0; start < words.length; start += TEXT_INDEX_BUILD_BATCH_ENTRIES) {
    const end = Math.min(words.length, start + TEXT_INDEX_BUILD_BATCH_ENTRIES);
    for (let wordId = start; wordId < end; wordId += 1) {
      wordTrigrams.clear();
      addTextTrigrams(words[wordId], wordTrigrams);
      for (const trigram of wordTrigrams) {
        let wordIds = wordTrigramLists.get(trigram);
        if (!wordIds) {
          wordIds = [];
          wordTrigramLists.set(trigram, wordIds);
        }
        wordIds.push(wordId);
      }
    }
    if (end < words.length) await yieldTextIndexBuild();
    if (!isCurrent()) return undefined;
  }

  const wordPostings: Uint32Array[] = new Array(words.length);
  for (let wordId = 0; wordId < wordPostingLists.length; wordId += 1) {
    const posting = wordPostingLists[wordId]!;
    wordPostings[wordId] =
      typeof posting === 'number' ? Uint32Array.of(posting) : Uint32Array.from(posting);
  }
  const wordTrigramPostings = new Map<number, Uint32Array>();
  for (const [trigram, wordIds] of wordTrigramLists) {
    wordTrigramPostings.set(trigram, Uint32Array.from(wordIds));
  }
  const tablePostings = new Map<string, Uint32Array>();
  for (const [table, posting] of tablePostingLists) {
    tablePostings.set(table, Uint32Array.from(posting));
  }

  // The retained index uses packed integer postings; construction maps/lists
  // are local and become collectible as soon as this function returns.
  wordsById.clear();
  wordTrigramLists.clear();
  tablePostingLists.clear();
  return {
    entryCount: entries.length,
    words,
    wordPostings,
    wordTrigramPostings,
    tablePostings,
    tableCounts,
    unnamedCount,
  };
}

/** Invalidate the lazy text index when worker enrichment changes searchable text. */
export function invalidateTextSearchIndex(entries: SearchIndexEntry[]): void {
  textSearchVersions.set(entries, (textSearchVersions.get(entries) ?? 0) + 1);
  textSearchIndexes.delete(entries);
  textSearchBuilds.delete(entries);
}

/**
 * Build the worker's text index lazily in yielding batches. The first query
 * uses the exact full scan; later searches use the finished postings without
 * blocking worker startup or holding a long task on the UI thread.
 */
export function prepareTextSearchIndex(entries: SearchIndexEntry[]): Promise<void> {
  if (entries.length < MIN_TEXT_INDEX_ENTRIES) return Promise.resolve();
  const existing = textSearchIndexes.get(entries);
  if (existing?.entryCount === entries.length) return Promise.resolve();
  const inFlight = textSearchBuilds.get(entries);
  if (inFlight) return inFlight;

  const version = textSearchVersions.get(entries) ?? 0;
  let buildPromise: Promise<void>;
  buildPromise = buildTextSearchIndex(
    entries,
    () =>
      (textSearchVersions.get(entries) ?? 0) === version &&
      entries.length >= MIN_TEXT_INDEX_ENTRIES,
  )
    .then((index) => {
      if (
        index &&
        (textSearchVersions.get(entries) ?? 0) === version &&
        entries.length === index.entryCount
      ) {
        textSearchIndexes.set(entries, index);
      }
    })
    .finally(() => {
      if (textSearchBuilds.get(entries) === buildPromise) textSearchBuilds.delete(entries);
    });
  textSearchBuilds.set(entries, buildPromise);
  return buildPromise;
}

export function hasIndexableTextSearchTerms(parsed: ParsedQuery): boolean {
  const required = requiredTextTokens(parsed.ast ?? null);
  return required.some(isIndexableSearchWord);
}

/**
 * Text atoms guaranteed by the Boolean expression: AND unions requirements,
 * OR intersects them, while NOT contributes no safe narrowing predicate.
 */
function requiredTextTokens(ast: QueryNode | null): string[] {
  if (ast === null) return [];
  switch (ast.type) {
    case 'atom':
      return ast.kind === 'text' ? [ast.value] : [];
    case 'not':
      return [];
    case 'and': {
      const tokens = new Set<string>();
      for (const child of ast.children) {
        for (const token of requiredTextTokens(child)) tokens.add(token);
      }
      return [...tokens];
    }
    case 'or': {
      if (ast.children.length === 0) return [];
      const common = new Set(requiredTextTokens(ast.children[0]!));
      for (let childIndex = 1; childIndex < ast.children.length; childIndex += 1) {
        const childTokens = new Set(requiredTextTokens(ast.children[childIndex]!));
        for (const token of common) {
          if (!childTokens.has(token)) common.delete(token);
        }
        if (common.size === 0) break;
      }
      return [...common];
    }
  }
}

interface TextSearchCandidates {
  indices: Uint32Array;
  unnamedCount: number;
  tableCount?: number;
  tableUnnamedCount?: number;
}

function isIndexableSearchWord(token: string): boolean {
  if (token.length < 3) return false;
  let hasLetter = false;
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index);
    if (!isWordCharCode(code)) return false;
    if (code >= 97 && code <= 122) hasLetter = true;
  }
  return hasLetter;
}

function appendUniqueWordPosting(
  target: number[],
  seen: Uint8Array,
  posting: Uint32Array,
): void {
  for (let index = 0; index < posting.length; index += 1) {
    const entryIndex = posting[index]!;
    if (seen[entryIndex] !== 0) continue;
    seen[entryIndex] = 1;
    target.push(entryIndex);
  }
}

function entriesForWordTerm(
  index: TextSearchIndex,
  term: string,
  candidateWordIds: Uint32Array,
): Uint32Array {
  let firstPosting: Uint32Array | undefined;
  let seen: Uint8Array | undefined;
  let candidates: number[] | undefined;

  for (let wordIndex = 0; wordIndex < candidateWordIds.length; wordIndex += 1) {
    const wordId = candidateWordIds[wordIndex]!;
    if (!index.words[wordId]!.includes(term)) continue;
    const posting = index.wordPostings[wordId]!;
    if (firstPosting === undefined) {
      firstPosting = posting;
      continue;
    }
    if (!seen) {
      seen = new Uint8Array(index.entryCount);
      candidates = [];
      appendUniqueWordPosting(candidates, seen, firstPosting);
    }
    appendUniqueWordPosting(candidates!, seen, posting);
  }

  if (firstPosting === undefined) return new Uint32Array(0);
  if (!candidates) return firstPosting;
  candidates.sort((a, b) => a - b);
  return Uint32Array.from(candidates);
}

function findTextSearchCandidates(
  entries: SearchIndexEntry[],
  ast: QueryNode | null,
  context: SearchContext | undefined,
  enabled: boolean,
  uiTableKey: string | undefined,
): TextSearchCandidates | undefined {
  if (!enabled) return undefined;
  const required = requiredTextTokens(ast);
  const indexableTerms =
    context?.fuzzy?.enabled === true ? [] : required.filter(isIndexableSearchWord);
  const canUseTextPostings =
    indexableTerms.length > 0;
  if (!canUseTextPostings && uiTableKey === undefined) return undefined;
  const index = textSearchIndexes.get(entries);
  if (!index) return undefined;
  if (index.entryCount !== entries.length) {
    void prepareTextSearchIndex(entries).catch(() => undefined);
    return undefined;
  }

  let selectedPosting: Uint32Array | undefined;
  if (canUseTextPostings) {
    // A query word can match as a substring of any indexed word. One rare
    // trigram-to-word posting is a safe word superset; the exact scorer verifies
    // the original query against each candidate.
    let selectedWordIds: Uint32Array | undefined;
    let selectedTerm: string | undefined;
    let selectedWordCost = Number.POSITIVE_INFINITY;
    for (const term of indexableTerms) {
      const termTrigrams = new Set<number>();
      for (let offset = 0; offset <= term.length - 3; offset += 1) {
        termTrigrams.add(numericTrigramAt(term, offset));
      }
      let termWordIds: Uint32Array | undefined;
      for (const trigram of termTrigrams) {
        const posting = index.wordTrigramPostings.get(trigram);
        if (!posting) {
          return {
            indices: new Uint32Array(0),
            unnamedCount: index.unnamedCount,
            ...(uiTableKey === undefined
              ? {}
              : {
                  tableCount: index.tableCounts.get(uiTableKey)?.count ?? 0,
                  tableUnnamedCount: index.tableCounts.get(uiTableKey)?.unnamedCount ?? 0,
            }),
          };
        }
        if (!termWordIds || posting.length < termWordIds.length) termWordIds = posting;
      }
      const matchingWordIds: number[] = [];
      let wordCost = 0;
      if (termWordIds) {
        for (let wordIndex = 0; wordIndex < termWordIds.length; wordIndex += 1) {
          const wordId = termWordIds[wordIndex]!;
          if (!index.words[wordId]!.includes(term)) continue;
          matchingWordIds.push(wordId);
          wordCost += index.wordPostings[wordId]!.length;
        }
      }
      if (matchingWordIds.length === 0) {
        return {
          indices: new Uint32Array(0),
          unnamedCount: index.unnamedCount,
          ...(uiTableKey === undefined
            ? {}
            : {
                tableCount: index.tableCounts.get(uiTableKey)?.count ?? 0,
                tableUnnamedCount: index.tableCounts.get(uiTableKey)?.unnamedCount ?? 0,
              }),
        };
      }
      if (!selectedWordIds || wordCost < selectedWordCost) {
        selectedWordIds = Uint32Array.from(matchingWordIds);
        selectedTerm = term;
        selectedWordCost = wordCost;
      }
    }
    if (selectedWordIds && selectedTerm) {
      selectedPosting = entriesForWordTerm(index, selectedTerm, selectedWordIds);
    }
  }

  let tableCount: number | undefined;
  let tableUnnamedCount: number | undefined;
  if (uiTableKey !== undefined) {
    const table = index.tablePostings.get(uiTableKey);
    const counts = index.tableCounts.get(uiTableKey);
    tableCount = counts?.count ?? 0;
    tableUnnamedCount = counts?.unnamedCount ?? 0;
    if (!table) {
      return {
        indices: new Uint32Array(0),
        unnamedCount: index.unnamedCount,
        tableCount,
        tableUnnamedCount,
      };
    }
    if (!selectedPosting || table.length < selectedPosting.length) selectedPosting = table;
  }

  if (!selectedPosting) return undefined;
  return {
    indices: selectedPosting,
    unnamedCount: index.unnamedCount,
    ...(tableCount === undefined ? {} : { tableCount }),
    ...(tableUnnamedCount === undefined ? {} : { tableUnnamedCount }),
  };
}

function entryFlag(entry: SearchIndexEntry, key: FlagKey): boolean {
  switch (key) {
    case 'redacted':
      return entry.isRedacted === true;
    case 'adept':
      return entry.isAdept === true;
    case 'holofoil':
      return entry.isHolofoil === true;
    case 'featured':
      return entry.isFeatured === true;
    case 'enhanced':
      return entry.isEnhanced === true;
    case 'dummy':
      return entry.isDummy === true;
    case 'hasLore':
      return entry.hasLore === true;
    case 'hasIcon':
      return entry.icon !== undefined;
    case 'hasScreenshot':
      return entry.hasScreenshot === true;
    case 'hasWatermark':
      return entry.iconWatermark !== undefined;
    case 'hasFlavor':
      return entry.hasFlavor === true;
    case 'hasCollectible':
      return entry.hasCollectible === true;
    case 'artifact':
      return entry.isArtifact === true || entry.isArtifactPerk === true;
    case 'artifactPerk':
      return entry.isArtifactPerk === true;
    case 'craftable':
      return entry.isCraftable === true;
    case 'catalyst':
      return entry.isCatalyst === true;
    case 'ornament':
      return entry.isOrnament === true;
    default:
      return false;
  }
}

function sourceMatches(
  entry: SearchIndexEntry,
  token: string,
  normalizedToken: string,
  context?: SearchContext,
): boolean {
  if (!token) return false;
  const canonical = context?.sourceAliasToKey?.get(normalizedToken);
  if (canonical && entry.sourceTags?.includes(canonical) === true) return true;
  if (normalizedToken.length >= 3 && entry.sourceTags) {
    for (const tag of entry.sourceTags) {
      if (tag === normalizedToken || tag.includes(normalizedToken)) return true;
    }
  }
  if (entry.sourceLower?.includes(token) === true) return true;
  return entry.descLower.includes(token);
}

function traitMatches(entry: SearchIndexEntry, token: string): boolean {
  if (!token) return false;
  const traitIds = entry.traitIds;
  if (!traitIds) return false;
  for (const trait of traitIds) {
    if (trait.includes(token)) return true;
  }
  return false;
}

function resolveSeasonNumbers(
  tokens: readonly string[],
  context: SearchContext | undefined,
): Set<number> | undefined {
  if (tokens.length === 0) return undefined;
  const result = new Set<number>();
  for (const raw of tokens) {
    const token = raw.toLowerCase();
    if (token === 'latest' || token === 'current') {
      if (context?.latestSeason !== undefined) result.add(context.latestSeason);
      continue;
    }
    const numeric = Number(token);
    if (Number.isInteger(numeric) && numeric >= 0) {
      result.add(numeric);
      continue;
    }
    if (context?.seasonNameMap) {
      for (const [seasonNumber, name] of context.seasonNameMap) {
        if (name.toLowerCase().includes(token)) result.add(seasonNumber);
      }
    }
    if (context?.seasonAliases) {
      for (const [seasonNumber, alias] of Object.entries(context.seasonAliases)) {
        const num = Number(seasonNumber);
        if (Number.isNaN(num)) continue;
        if (alias.fallbackName.toLowerCase().includes(token)) result.add(num);
        for (const name of alias.aliases) {
          if (name.toLowerCase().includes(token)) result.add(num);
        }
      }
    }
  }
  return result;
}

/**
 * Resolve a single season token to exactly one season number, for comparison
 * operators like `season:>=heresy`. Falls back to the lowest matching season
 * when a name fragment matches more than one.
 */
function resolveSingleSeasonNumber(
  token: string,
  context: SearchContext | undefined,
): number | undefined {
  const lower = token.toLowerCase();
  if (lower === 'latest' || lower === 'current') return context?.latestSeason;
  const numeric = Number(lower);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;

  const candidates: Array<[number, string]> = [];
  if (context?.seasonNameMap) {
    for (const [num, name] of context.seasonNameMap) candidates.push([num, name]);
  }
  if (context?.seasonAliases) {
    for (const [seasonStr, alias] of Object.entries(context.seasonAliases)) {
      const num = Number(seasonStr);
      if (Number.isNaN(num)) continue;
      candidates.push([num, alias.fallbackName]);
      for (const name of alias.aliases) candidates.push([num, name]);
    }
  }
  for (const [num, name] of candidates) {
    if (name.toLowerCase() === lower) return num;
  }
  let best: number | undefined;
  for (const [num, name] of candidates) {
    if (name.toLowerCase().includes(lower)) {
      if (best === undefined || num < best) best = num;
    }
  }
  return best;
}

/**
 * Filter option 20 means Shader, which lives in the item sub-type because
 * shaders share the Mod item type. Option 19 (Mod) excludes those shaders.
 */
function matchesTypeValue(entry: SearchIndexEntry, value: number): boolean {
  if (value === 20) return entry.itemSubType === 20;
  if (value === 19) return entry.itemType === 19 && entry.itemSubType !== 20;
  return entry.itemType === value;
}

function matchesAnyType(entry: SearchIndexEntry, values: readonly number[]): boolean {
  for (const value of values) {
    if (matchesTypeValue(entry, value)) return true;
  }
  return false;
}

function tableKey(table: string): string {
  return getShortTableName(table).toLowerCase();
}

/**
 * Table names are a small, fixed set, so memoize their normalized keys instead
 * of re-running the short-name regex for every entry of every scan.
 */
const tableKeyCache = new Map<string, string>();

function cachedTableKey(table: string): string {
  let key = tableKeyCache.get(table);
  if (key === undefined) {
    key = tableKey(table);
    tableKeyCache.set(table, key);
  }
  return key;
}

const ARTIFACT_PERKS_KEY = tableKey(ARTIFACT_PERKS_TABLE);

function categoryMatches(
  entry: SearchIndexEntry,
  token: string,
  categoryLowerNames: Map<number, string>,
): boolean {
  const hashes = entry.itemCategoryHashes;
  if (!hashes || hashes.length === 0) return false;
  for (const hash of hashes) {
    const name = categoryLowerNames.get(hash);
    if (name?.includes(token)) return true;
  }
  return false;
}

/** Build the lowercased category-name lookup once per search, on first use. */
function ensureCategoryLowerNames(evalCtx: EvalContext): Map<number, string> {
  let names = evalCtx.categoryLowerNames;
  if (!names) {
    names = new Map<number, string>();
    for (const [hash, name] of evalCtx.categoryNameMap) names.set(hash, name.toLowerCase());
    evalCtx.categoryLowerNames = names;
  }
  return names;
}

const asciiSortableNameCache = new WeakMap<SearchIndexEntry, boolean>();

function isAsciiSortableName(entry: SearchIndexEntry): boolean {
  const cached = asciiSortableNameCache.get(entry);
  if (cached !== undefined) return cached;
  const name = entry.nameLower;
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (
      code !== 32 &&
      !(code >= 48 && code <= 57) &&
      !(code >= 97 && code <= 122)
    ) {
      asciiSortableNameCache.set(entry, false);
      return false;
    }
  }
  asciiSortableNameCache.set(entry, true);
  return true;
}

function compareNames(a: SearchIndexEntry, b: SearchIndexEntry): number {
  if (!a.name && !b.name) return a.hash - b.hash;
  if (!a.name) return 1;
  if (!b.name) return -1;
  const left = a.nameLower;
  const right = b.nameLower;
  if (isAsciiSortableName(a) && isAsciiSortableName(b)) {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return left.localeCompare(right);
}

function toResult(
  entry: SearchIndexEntry,
  entryDates?: Map<SearchIndexEntry, EntryDateRecord>,
): SearchResultItem {
  const item: SearchResultItem = {
    hash: entry.hash,
    table: entry.table,
    name: entry.name,
    subtitle: entry.subtitle,
  };
  if (entry.icon !== undefined) item.icon = entry.icon;
  if (entry.iconWatermark !== undefined) item.iconWatermark = entry.iconWatermark;
  if (entry.tierType !== undefined) item.tierType = entry.tierType;
  if (entry.damageType !== undefined) item.damageType = entry.damageType;
  if (entry.classType !== undefined) item.classType = entry.classType;
  if (entry.isRedacted !== undefined) item.isRedacted = entry.isRedacted;
  if (entry.isEnhanced !== undefined) item.isEnhanced = entry.isEnhanced;
  if (entry.index !== undefined) item.index = entry.index;
  if (entry.isArtifactPerk !== undefined) item.isArtifactPerk = entry.isArtifactPerk;
  if (entry.parentArtifactHash !== undefined) item.parentArtifactHash = entry.parentArtifactHash;
  if (entry.parentArtifactName !== undefined) item.parentArtifactName = entry.parentArtifactName;
  if (entry.parentArtifactIcon !== undefined) item.parentArtifactIcon = entry.parentArtifactIcon;
  if (entryDates) {
    const date = entryDates.get(entry);
    item.firstVersionIndex = date?.firstVersionIndex ?? -1;
    item.lastVersionIndex = date?.lastVersionIndex ?? -1;
    item.firstDateInferred = date?.firstInferred ?? false;
  }
  return item;
}

/**
 * Stable-partition a fully sorted result list by canonical table, then select
 * the first page with a fair per-table quota. The page may exceed a very small
 * requested limit when that is necessary to represent every non-empty table.
 */
export function groupSearchResults(
  items: SearchResultItem[],
  limit?: number,
): { items: SearchResultItem[]; groups: SearchResultGroup[] } {
  const rankByTable = new Map<string, number>();
  Object.keys(TABLE_METADATA).forEach((table, index) => {
    const canonical = canonicalTableName(table);
    if (!rankByTable.has(canonical)) rankByTable.set(canonical, index);
  });

  const grouped = new Map<string, SearchResultItem[]>();
  for (const item of items) {
    const key = canonicalTableName(item.table);
    const group = grouped.get(key);
    if (group) group.push(item);
    else grouped.set(key, [item]);
  }

  const keys = [...grouped.keys()].sort((a, b) => {
    const aRank = rankByTable.get(a);
    const bRank = rankByTable.get(b);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return a.localeCompare(b);
  });

  const total = items.length;
  const pageLimit =
    limit === undefined || !Number.isFinite(limit)
      ? total
      : Math.max(0, Math.trunc(limit));
  const quotas = keys.map((key) => Math.min(grouped.get(key)!.length, pageLimit));
  const allocated = (): number => quotas.reduce((sum, quota) => sum + quota, 0);

  if (pageLimit < total && pageLimit > 0 && keys.length > 0) {
    const baseQuota = Math.max(1, Math.floor(pageLimit / keys.length));
    for (let index = 0; index < keys.length; index += 1) {
      quotas[index] = Math.min(grouped.get(keys[index]!)!.length, baseQuota);
    }

    let loaded = allocated();
    while (loaded < pageLimit) {
      let added = false;
      for (let index = 0; index < keys.length && loaded < pageLimit; index += 1) {
        const key = keys[index]!;
        const count = grouped.get(key)!.length;
        if (quotas[index]! >= count) continue;
        quotas[index] = quotas[index]! + 1;
        loaded += 1;
        added = true;
      }
      if (!added) break;
    }
  }

  const groups: SearchResultGroup[] = [];
  const pageItems: SearchResultItem[] = [];
  keys.forEach((key, index) => {
    const entries = grouped.get(key)!;
    const loaded = Math.min(entries.length, quotas[index] ?? 0);
    groups.push({
      key,
      label: getFriendlyTableName(key),
      count: entries.length,
      loaded,
    });
    pageItems.push(...entries.slice(0, loaded));
  });
  return { items: pageItems, groups };
}

/* -------------------------------------------------------------------------- */
/* AST evaluation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The virtual ArtifactPerks table matches artifact perk entries regardless of
 * their underlying InventoryItem table.
 */
function matchesTableKey(entry: SearchIndexEntry, key: string): boolean {
  return key === ARTIFACT_PERKS_KEY
    ? entry.isArtifactPerk === true
    : cachedTableKey(entry.table) === key;
}

interface EvalContext {
  context: SearchContext | undefined;
  categoryNameMap: Map<number, string>;
  /** Per-entry text scores shared by AST evaluation and relevance scoring. */
  textScores: Map<string, number>;
  /** Lowercased category names, built once per search on first use. */
  categoryLowerNames: Map<number, string> | undefined;
  /** source token -> normalized lookup key, resolved once per search. */
  sourceNormTokens: Map<string, string>;
  /** season token -> resolved set of season numbers (undefined = unresolvable). */
  seasonNumbers: Map<string, Set<number> | undefined>;
  /** season token -> resolved single number for `>`/`>=`/`<`/`<=`. */
  seasonComparisonNumbers: Map<string, number | undefined>;
}

/** Resolve a source token's normalized form once per search, not per entry. */
function normalizedSourceToken(evalCtx: EvalContext, token: string): string {
  let norm = evalCtx.sourceNormTokens.get(token);
  if (norm === undefined) {
    norm = normalizeSourceLookup(token);
    evalCtx.sourceNormTokens.set(token, norm);
  }
  return norm;
}

function evaluateAtom(atom: QueryAtom, entry: SearchIndexEntry, evalCtx: EvalContext): boolean {
  switch (atom.kind) {
    case 'table':
      return matchesTableKey(entry, cachedTableKey(atom.table));
    case 'tier':
      return entry.tierType !== undefined && compareValues(entry.tierType, atom.op, atom.value);
    case 'damage':
      return entry.damageType !== undefined && entry.damageType === atom.value;
    case 'class':
      return entry.classType !== undefined && entry.classType === atom.value;
    case 'type':
      return matchesTypeValue(entry, atom.value);
    case 'ammo':
      return entry.ammoType !== undefined && entry.ammoType === atom.value;
    case 'slot':
      return entry.bucketHash !== undefined && entry.bucketHash === atom.value;
    case 'subtype':
      return entry.itemSubType !== undefined && entry.itemSubType === atom.value;
    case 'season': {
      if (atom.op === '=') {
        const numbers = evalCtx.seasonNumbers.get(atom.value);
        if (numbers === undefined || numbers.size === 0) return false;
        return entry.seasonNumber !== undefined && numbers.has(entry.seasonNumber);
      }
      const target = evalCtx.seasonComparisonNumbers.get(atom.value);
      if (target === undefined) return false;
      return entry.seasonNumber !== undefined && compareValues(entry.seasonNumber, atom.op, target);
    }
    case 'source':
      return sourceMatches(entry, atom.value, normalizedSourceToken(evalCtx, atom.value), evalCtx.context);
    case 'trait':
      return traitMatches(entry, atom.value);
    case 'category':
      return categoryMatches(entry, atom.value, ensureCategoryLowerNames(evalCtx));
    case 'flag':
      return entryFlag(entry, atom.flag);
    case 'hash':
      return entry.hash === atom.value;
    case 'never':
      return false;
    case 'text': {
      const cachedScore = evalCtx.textScores.get(atom.value);
      if (cachedScore !== undefined) return cachedScore > 0;
      const score = scoreToken(entry, atom.value, evalCtx.context);
      evalCtx.textScores.set(atom.value, score);
      return score > 0;
    }
  }
}

function evaluateNode(node: QueryNode, entry: SearchIndexEntry, evalCtx: EvalContext): boolean {
  switch (node.type) {
    case 'and':
      for (const child of node.children) {
        if (!evaluateNode(child, entry, evalCtx)) return false;
      }
      return true;
    case 'or':
      for (const child of node.children) {
        if (evaluateNode(child, entry, evalCtx)) return true;
      }
      return false;
    case 'not':
      return !evaluateNode(node.child, entry, evalCtx);
    case 'atom':
      return evaluateAtom(node, entry, evalCtx);
  }
}

/**
 * Project a query AST onto its table atoms. Non-table atoms are treated as
 * unknown, so the result identifies entries that could match the table portion
 * of the query without requiring unrelated text/metadata predicates to match.
 */
function tableScopePossibility(current: QueryNode, entry: SearchIndexEntry): number {
  switch (current.type) {
    case 'and': {
      let canMatch = true;
      let canFail = false;
      for (const child of current.children) {
        const possibility = tableScopePossibility(child, entry);
        canMatch = canMatch && (possibility & 1) !== 0;
        canFail = canFail || (possibility & 2) !== 0;
      }
      return (canMatch ? 1 : 0) | (canFail ? 2 : 0);
    }
    case 'or': {
      let canMatch = false;
      let canFail = true;
      for (const child of current.children) {
        const possibility = tableScopePossibility(child, entry);
        canMatch = canMatch || (possibility & 1) !== 0;
        canFail = canFail && (possibility & 2) !== 0;
      }
      return (canMatch ? 1 : 0) | (canFail ? 2 : 0);
    }
    case 'not': {
      const possibility = tableScopePossibility(current.child, entry);
      return ((possibility & 2) >> 1) | ((possibility & 1) << 1);
    }
    case 'atom':
      if (current.kind !== 'table') return 3;
      return matchesTableKey(entry, cachedTableKey(current.table)) ? 1 : 2;
  }
}

function couldMatchQueryTableScope(node: QueryNode, entry: SearchIndexEntry): boolean {
  return (tableScopePossibility(node, entry) & 1) !== 0;
}

function hasTableAtom(ast: QueryNode | null): boolean {
  if (ast === null) return false;
  switch (ast.type) {
    case 'and':
    case 'or':
      return ast.children.some(hasTableAtom);
    case 'not':
      return hasTableAtom(ast.child);
    case 'atom':
      return ast.kind === 'table';
  }
}

interface ScoringInfo {
  /** Positive text atoms (ignoring negated subtrees) for relevance scoring. */
  textTokens: string[];
  /** Count of positive hash atoms (ignoring negated subtrees). */
  hashCount: number;
}

function collectScoring(ast: QueryNode | null): ScoringInfo {
  const textTokens: string[] = [];
  const seenTokens = new Set<string>();
  let hashCount = 0;
  const visit = (node: QueryNode, negated: boolean): void => {
    switch (node.type) {
      case 'and':
      case 'or':
        for (const child of node.children) visit(child, negated);
        return;
      case 'not':
        visit(node.child, !negated);
        return;
      case 'atom':
        if (negated) return;
        if (node.kind === 'text') {
          if (!seenTokens.has(node.value)) {
            seenTokens.add(node.value);
            textTokens.push(node.value);
          }
        } else if (node.kind === 'hash') {
          hashCount += 1;
        }
        return;
    }
  };
  if (ast !== null) visit(ast, false);
  return { textTokens, hashCount };
}

function isTextOnlyConjunction(node: QueryNode | null): boolean {
  if (node === null) return false;
  if (node.type === 'atom') return node.kind === 'text';
  return node.type === 'and' && node.children.every(isTextOnlyConjunction);
}

function collectSeasonNumbers(
  ast: QueryNode | null,
  context: SearchContext | undefined,
): Map<string, Set<number> | undefined> {
  const tokens = new Set<string>();
  const visit = (node: QueryNode): void => {
    switch (node.type) {
      case 'and':
      case 'or':
        for (const child of node.children) visit(child);
        return;
      case 'not':
        visit(node.child);
        return;
      case 'atom':
        if (node.kind === 'season' && node.op === '=') tokens.add(node.value);
        return;
    }
  };
  if (ast !== null) visit(ast);
  const result = new Map<string, Set<number> | undefined>();
  for (const token of tokens) {
    result.set(token, resolveSeasonNumbers([token], context));
  }
  return result;
}

function collectSeasonComparisonNumbers(
  ast: QueryNode | null,
  context: SearchContext | undefined,
): Map<string, number | undefined> {
  const tokens = new Set<string>();
  const visit = (node: QueryNode): void => {
    switch (node.type) {
      case 'and':
      case 'or':
        for (const child of node.children) visit(child);
        return;
      case 'not':
        visit(node.child);
        return;
      case 'atom':
        if (node.kind === 'season' && node.op !== '=') tokens.add(node.value);
        return;
    }
  };
  if (ast !== null) visit(ast);
  const result = new Map<string, number | undefined>();
  for (const token of tokens) {
    result.set(token, resolveSingleSeasonNumber(token, context));
  }
  return result;
}

/**
 * Apply structured text filters plus the UI filter popover, rank the survivors
 * and return up to `maxResults`. An omitted or sufficiently large limit keeps
 * all matches, which also avoids allocating the bounded top-K heap.
 */
export function scoreAndFilterEntries(
  entries: SearchIndexEntry[],
  parsed: ParsedQuery,
  uiFilters: SearchFilters,
  sort: SortMode,
  categoryNameMap: Map<number, string>,
  maxResults?: number,
  context?: SearchContext,
  useTextIndex = true,
): SearchResponse {
  const startedAt = Date.now();

  const ast = parsed.ast ?? null;
  const scoring = collectScoring(ast);
  const textOnlyConjunction = isTextOnlyConjunction(ast);
  const evalCtx: EvalContext = {
    context,
    categoryNameMap,
    textScores: new Map<string, number>(),
    categoryLowerNames: undefined,
    sourceNormTokens: new Map<string, string>(),
    seasonNumbers: collectSeasonNumbers(ast, context),
    seasonComparisonNumbers: collectSeasonComparisonNumbers(ast, context),
  };

  const uiTableKey =
    uiFilters.table && uiFilters.table !== 'all' && uiFilters.table !== ''
      ? cachedTableKey(uiFilters.table)
      : undefined;
  const tableScoped = uiTableKey !== undefined || hasPositiveTableScope(ast);
  const unnamedMode = uiFilters.unnamedMode ?? 'auto';
  const effectiveIncludeUnnamed =
    unnamedMode === 'always' ||
    (unnamedMode !== 'never' && (uiFilters.includeUnnamed || tableScoped));
  const queryHasTableAtom = hasTableAtom(ast);
  const candidateSet = findTextSearchCandidates(
    entries,
    ast,
    context,
    useTextIndex,
    uiTableKey,
  );
  const candidateIndices = candidateSet?.indices;

  const selectedCategories = uiFilters.itemCategoryHashes.filter((hash) => hash !== 0);

  const compare = scoredComparator(sort, context?.entryDates);
  // `slice(0, maxResults)` truncates toward zero and clamps negatives to an
  // empty result, so mirror that exactly for the bounded selection.
  const limit =
    maxResults === undefined || !Number.isFinite(maxResults)
      ? undefined
      : Math.max(0, Math.trunc(maxResults));
  // `entries.length` is a cheap safe upper bound for the number of survivors:
  // if the requested limit covers it, no candidate can be discarded.
  const keepAll = limit === undefined || limit >= entries.length;
  // Native sort is faster than maintaining a JS heap for a small indexed
  // candidate set. Bound it so broad queries retain the O(limit) heap path.
  const sortCandidateSet =
    !keepAll &&
    (limit ?? 0) > 0 &&
    candidateIndices !== undefined &&
    candidateIndices.length <= 30_000;
  const scored: ScoredEntry[] = [];
  const topK = keepAll || sortCandidateSet ? null : new ScoredEntryTopK(limit ?? 0, compare);
  // One reusable candidate so rejected entries never allocate.
  const candidate: ScoredEntry = { entry: entries[0]!, score: 0, order: 0 };
  let totalMatches = 0;
  let scopeEntryCount = 0;
  let hiddenUnnamedCount = 0;

  // Scope/unnamed diagnostics are query-independent. Count them in a compact
  // pass, then score only indexed text candidates when a safe superset exists.
  if (candidateSet !== undefined) {
    if (queryHasTableAtom && ast !== null) {
      for (const entry of entries) {
        if (uiTableKey && !matchesTableKey(entry, uiTableKey)) continue;
        if (!couldMatchQueryTableScope(ast, entry)) continue;
        scopeEntryCount += 1;
        if (!effectiveIncludeUnnamed && !entry.name) hiddenUnnamedCount += 1;
      }
    } else if (uiTableKey !== undefined) {
      scopeEntryCount = candidateSet.tableCount ?? 0;
      if (!effectiveIncludeUnnamed) {
        hiddenUnnamedCount = candidateSet.tableUnnamedCount ?? 0;
      }
    } else {
      scopeEntryCount = entries.length;
      if (!effectiveIncludeUnnamed) hiddenUnnamedCount = candidateSet.unnamedCount;
    }
  }

  const iterationCount = candidateIndices?.length ?? entries.length;
  for (let candidateOrder = 0; candidateOrder < iterationCount; candidateOrder += 1) {
    const order = candidateIndices?.[candidateOrder] ?? candidateOrder;
    const entry = entries[order]!;
    if (uiTableKey && !matchesTableKey(entry, uiTableKey)) continue;
    if (queryHasTableAtom && ast !== null && !couldMatchQueryTableScope(ast, entry)) continue;

    if (candidateIndices === undefined) scopeEntryCount += 1;
    if (!effectiveIncludeUnnamed && !entry.name) {
      if (candidateIndices === undefined) hiddenUnnamedCount += 1;
      continue;
    }

    if (uiFilters.tierTypes.length > 0) {
      if (entry.tierType === undefined || !uiFilters.tierTypes.includes(entry.tierType)) continue;
    }
    if (uiFilters.damageTypes.length > 0) {
      if (entry.damageType === undefined || !uiFilters.damageTypes.includes(entry.damageType)) continue;
    }
    if (uiFilters.classTypes.length > 0) {
      if (entry.classType === undefined || !uiFilters.classTypes.includes(entry.classType)) continue;
    }
    if (uiFilters.itemTypes.length > 0 && !matchesAnyType(entry, uiFilters.itemTypes)) continue;
    if (selectedCategories.length > 0) {
      const entryCategories = entry.itemCategoryHashes;
      if (!entryCategories || entryCategories.length === 0) continue;
      let categoryMatches = false;
      for (const hash of selectedCategories) {
        if (entryCategories.includes(hash)) {
          categoryMatches = true;
          break;
        }
      }
      if (!categoryMatches) continue;
    }
    if (uiFilters.onlyRedacted && entry.isRedacted !== true) continue;

    let score = 0;
    if (textOnlyConjunction) {
      let textMatches = true;
      for (const token of scoring.textTokens) {
        const tokenScore = scoreToken(entry, token, context);
        if (tokenScore === 0) {
          textMatches = false;
          break;
        }
        score += tokenScore;
      }
      if (!textMatches) continue;
    } else {
      // The search box query AST is the single source of truth for every
      // structured/Boolean query. Text scores observed by the AST are reused
      // below instead of checking the same fields twice.
      evalCtx.textScores.clear();
      if (ast !== null && !evaluateNode(ast, entry, evalCtx)) continue;
      for (const token of scoring.textTokens) {
        score += evalCtx.textScores.get(token) ?? scoreToken(entry, token, context);
      }
    }
    if (scoring.hashCount > 0) score += 1000;
    if (entry.name) score += 10;
    if (entry.isDummy) score -= 10;
    else score += 15;

    totalMatches += 1;
    if (topK !== null) {
      candidate.entry = entry;
      candidate.score = score;
      candidate.order = order;
      topK.consider(candidate);
    } else {
      scored.push({ entry, score, order });
    }
  }

  // Only the retained <= limit winners are sorted; a full sort is kept when
  // the caller asked for everything (or the limit cannot exclude anything).
  const ordered = topK !== null ? topK.toSortedArray() : scored.sort(compare);
  const selected =
    sortCandidateSet && limit !== undefined && ordered.length > limit
      ? ordered.slice(0, limit)
      : ordered;

  return {
    items: selected.map(({ entry }) => toResult(entry, context?.entryDates)),
    totalMatches,
    durationMs: Date.now() - startedAt,
    scopeEntryCount,
    hiddenUnnamedCount,
  };
}
