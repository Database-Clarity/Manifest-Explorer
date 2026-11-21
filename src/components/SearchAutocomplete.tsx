/// <reference types="vite/client" />
import { useEffect, useRef, type ReactNode } from 'react';
import type { FilterOption, TableStatus } from '../types/manifest';
import styles from './SearchAutocomplete.module.scss';

/**
 * A single row in the search-bar autocomplete. It is deliberately a plain data
 * shape so the Header can build suggestions for keyboard handling and hand the
 * exact same list to the listbox renderer.
 */
export interface SearchSuggestion {
  /** Stable React key. */
  id: string;
  /** Full text inserted in place of the active token, without a trailing space. */
  insert: string;
  /** Monospace text shown on the row. */
  token: string;
  /** Human label or short description. */
  label: string;
  /** Matching items, when the manifest gives us a live count. */
  count?: number;
  /** Element-dot colour for damage values. */
  dot?: string;
  /** True when accepting should append a space (completed `key:value` tokens). */
  completesValue: boolean;
}

/**
 * Defensive view of the live source catalog. `FilterCatalog.sources` lands from
 * a parallel change, so every field is validated before use.
 */
export interface SearchAutocompleteSource {
  key: string;
  label: string;
  count?: number;
  aliases?: readonly string[];
}

/**
 * The slice of the filter catalog this component consumes. `FilterOption`
 * covers categories/seasons; sources use the richer key/label count shape.
 */
export interface SearchAutocompleteCatalog {
  categories: ReadonlyArray<FilterOption>;
  seasons?: ReadonlyArray<FilterOption>;
  sources?: ReadonlyArray<SearchAutocompleteSource>;
}

export interface SearchAutocompleteProps {
  /** Base id from `useId`; option ids derive from it for aria-activedescendant. */
  id: string;
  suggestions: readonly SearchSuggestion[];
  /** Index of the highlighted row, or -1 when nothing is highlighted yet. */
  highlightIndex: number;
  onHighlight: (index: number) => void;
  onAccept: (suggestion: SearchSuggestion) => void;
}

export interface SearchSuggestionResult {
  query: string;
  caret: number;
}

const MAX_SUGGESTIONS = 10;
const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

interface ValueOption {
  value: string;
  label: string;
  dot?: string;
}

type StaticValueGroup =
  | 'is'
  | 'has'
  | 'tier'
  | 'damage'
  | 'ammo'
  | 'slot'
  | 'class'
  | 'type'
  | 'subtype';

type ValueGroup = StaticValueGroup | 'season' | 'source' | 'table' | 'category';

interface OperatorSpec {
  key: string;
  description: string;
}

const IS_OPTIONS: readonly ValueOption[] = [
  { value: 'enhanced', label: 'Enhanced trait' },
  { value: 'adept', label: 'Adept' },
  { value: 'craftable', label: 'Craftable' },
  { value: 'catalyst', label: 'Catalyst' },
  { value: 'ornament', label: 'Ornament' },
  { value: 'artifactperk', label: 'Artifact perk' },
  { value: 'redacted', label: 'Redacted' },
];

const HAS_OPTIONS: readonly ValueOption[] = [
  { value: 'lore', label: 'Has lore' },
  { value: 'watermark', label: 'Has watermark' },
  { value: 'flavor', label: 'Has flavor text' },
  { value: 'collectible', label: 'Has collectible' },
  { value: 'screenshot', label: 'Has screenshot' },
  { value: 'icon', label: 'Has icon' },
];

const TIER_OPTIONS: readonly ValueOption[] = [
  { value: 'exotic', label: 'Exotic' },
  { value: 'legendary', label: 'Legendary' },
  { value: 'rare', label: 'Rare' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'common', label: 'Common' },
];

const DAMAGE_OPTIONS: readonly ValueOption[] = [
  { value: 'kinetic', label: 'Kinetic', dot: 'var(--el-kinetic)' },
  { value: 'arc', label: 'Arc', dot: 'var(--el-arc)' },
  { value: 'solar', label: 'Solar', dot: 'var(--el-solar)' },
  { value: 'void', label: 'Void', dot: 'var(--el-void)' },
  { value: 'stasis', label: 'Stasis', dot: 'var(--el-stasis)' },
  { value: 'strand', label: 'Strand', dot: 'var(--el-strand)' },
];

const AMMO_OPTIONS: readonly ValueOption[] = [
  { value: 'primary', label: 'Primary' },
  { value: 'special', label: 'Special' },
  { value: 'heavy', label: 'Heavy' },
];

const SLOT_OPTIONS: readonly ValueOption[] = [
  { value: 'kinetic', label: 'Kinetic' },
  { value: 'energy', label: 'Energy' },
  { value: 'power', label: 'Power' },
  { value: 'helmet', label: 'Helmet' },
  { value: 'gauntlets', label: 'Gauntlets' },
  { value: 'chest', label: 'Chest' },
  { value: 'legs', label: 'Legs' },
  { value: 'classitem', label: 'Class Item' },
  { value: 'ghost', label: 'Ghost' },
];

const CLASS_OPTIONS: readonly ValueOption[] = [
  { value: 'titan', label: 'Titan' },
  { value: 'hunter', label: 'Hunter' },
  { value: 'warlock', label: 'Warlock' },
];

const TYPE_OPTIONS: readonly ValueOption[] = [
  { value: 'weapon', label: 'Weapon' },
  { value: 'armor', label: 'Armor' },
  { value: 'mod', label: 'Mod' },
  { value: 'shader', label: 'Shader' },
  { value: 'emblem', label: 'Emblem' },
  { value: 'quest', label: 'Quest' },
  { value: 'subclass', label: 'Subclass' },
  { value: 'ghost', label: 'Ghost' },
  { value: 'ship', label: 'Ship' },
  { value: 'sparrow', label: 'Sparrow' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'engram', label: 'Engram' },
  { value: 'bounty', label: 'Bounty' },
  { value: 'emote', label: 'Emote' },
  { value: 'finisher', label: 'Finisher' },
  { value: 'pattern', label: 'Pattern' },
];

const SUBTYPE_OPTIONS: readonly ValueOption[] = [
  { value: 'autorifle', label: 'Auto Rifle' },
  { value: 'handcannon', label: 'Hand Cannon' },
  { value: 'pulserifle', label: 'Pulse Rifle' },
  { value: 'scout', label: 'Scout Rifle' },
  { value: 'smg', label: 'SMG' },
  { value: 'sidearm', label: 'Sidearm' },
  { value: 'bow', label: 'Bow' },
  { value: 'shotgun', label: 'Shotgun' },
  { value: 'sniper', label: 'Sniper Rifle' },
  { value: 'fusion', label: 'Fusion Rifle' },
  { value: 'glaive', label: 'Glaive' },
  { value: 'trace', label: 'Trace Rifle' },
  { value: 'grenadelauncher', label: 'Grenade Launcher' },
  { value: 'rocket', label: 'Rocket Launcher' },
  { value: 'sword', label: 'Sword' },
  { value: 'lfr', label: 'Linear Fusion Rifle' },
  { value: 'machinegun', label: 'Machine Gun' },
];

const STATIC_VALUE_OPTIONS: Readonly<Record<StaticValueGroup, readonly ValueOption[]>> = {
  is: IS_OPTIONS,
  has: HAS_OPTIONS,
  tier: TIER_OPTIONS,
  damage: DAMAGE_OPTIONS,
  ammo: AMMO_OPTIONS,
  slot: SLOT_OPTIONS,
  class: CLASS_OPTIONS,
  type: TYPE_OPTIONS,
  subtype: SUBTYPE_OPTIONS,
};

/** Filter keys mapped to the value list they complete. */
const KEY_GROUPS: Readonly<Record<string, ValueGroup>> = {
  is: 'is',
  has: 'has',
  tier: 'tier',
  rarity: 'tier',
  damage: 'damage',
  element: 'damage',
  dmg: 'damage',
  el: 'damage',
  ammo: 'ammo',
  slot: 'slot',
  class: 'class',
  type: 'type',
  subtype: 'subtype',
  weapon: 'subtype',
  season: 'season',
  s: 'season',
  source: 'source',
  table: 'table',
  t: 'table',
  cat: 'category',
  category: 'category',
  categories: 'category',
};

const OPERATOR_SPECS: readonly OperatorSpec[] = [
  { key: 'is', description: 'Flag · enhanced, adept, craftable…' },
  { key: 'has', description: 'Has · lore, watermark, flavor…' },
  { key: 'tier', description: 'Rarity · exotic, legendary, rare…' },
  { key: 'rarity', description: 'Rarity · alias of tier' },
  { key: 'damage', description: 'Element · kinetic, arc, solar…' },
  { key: 'element', description: 'Element · alias of damage' },
  { key: 'dmg', description: 'Element · alias of damage' },
  { key: 'el', description: 'Element · alias of damage' },
  { key: 'ammo', description: 'Ammo · primary, special, heavy' },
  { key: 'slot', description: 'Equip slot · kinetic, energy, power…' },
  { key: 'class', description: 'Class · titan, hunter, warlock' },
  { key: 'type', description: 'Item type · weapon, armor, mod…' },
  { key: 'subtype', description: 'Weapon frame · handcannon, smg…' },
  { key: 'weapon', description: 'Weapon frame · alias of subtype' },
  { key: 'season', description: 'Season · number, name, or latest' },
  { key: 'source', description: 'Source · raid, dungeon, trials…' },
  { key: 'table', description: 'Table · inventoryitem, perks…' },
  { key: 'trait', description: 'Trait · perk trait name' },
  { key: 'cat', description: 'Item category · Hand Cannon…' },
  { key: 'category', description: 'Item category · alias of cat' },
];

/** Core sources shown until the live catalog publishes its source list. */
const FALLBACK_SOURCES: readonly SearchAutocompleteSource[] = [
  { key: 'raid', label: 'Raid' },
  { key: 'dungeon', label: 'Dungeon' },
  { key: 'trials', label: 'Trials' },
  { key: 'ironbanner', label: 'Iron Banner' },
  { key: 'nightfall', label: 'Nightfall' },
  { key: 'strikes', label: 'Strikes' },
  { key: 'crucible', label: 'Crucible' },
  { key: 'gambit', label: 'Gambit' },
  { key: 'eververse', label: 'Eververse' },
  { key: 'seasonpass', label: 'Season Pass' },
  { key: 'events', label: 'Events' },
  { key: 'exoticquest', label: 'Exotic Quest' },
];

interface ActiveToken {
  /** Start of the whole token, including a leading `-`. */
  start: number;
  /** End of the whole token (exclusive). */
  end: number;
  /** Start of the token body, after an optional leading `-`. */
  bodyStart: number;
  negated: boolean;
  /** Lowercase key before the colon, or '' when there is no colon yet. */
  key: string;
  /** Absolute index of the colon, or -1. */
  colon: number;
}

interface RankedCandidate {
  match: readonly string[];
  suggestion: SearchSuggestion;
}

interface ScoredCandidate {
  score: number;
  order: number;
  suggestion: SearchSuggestion;
}

/**
 * Splits a query into token spans while keeping quoted segments together, so
 * `cat:"Hand Cannon"` stays one token. Quotes that are still open swallow the
 * rest of the query, which is exactly how the parser reads a partial phrase.
 */
function tokenSpans(query: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let inQuotes = false;
  let start = -1;

  for (let index = 0; index < query.length; index += 1) {
    const char = query.charAt(index);

    if (char === '"') {
      if (start < 0) start = index;
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (start >= 0) {
        spans.push({ start, end: index });
        start = -1;
      }
      continue;
    }

    if (start < 0) start = index;
  }

  if (start >= 0) spans.push({ start, end: query.length });
  return spans;
}

/** Finds the token under the caret, or null when the caret sits between tokens. */
function findActiveToken(query: string, caret: number): ActiveToken | null {
  const clamped = Math.max(0, Math.min(caret, query.length));
  const span = tokenSpans(query).find(
    (entry) => clamped >= entry.start && clamped <= entry.end,
  );
  if (!span) return null;

  let bodyStart = span.start;
  const negated = query.charAt(bodyStart) === '-' && span.end - bodyStart > 1;
  if (negated) bodyStart += 1;

  const relativeColon = query.slice(bodyStart, span.end).indexOf(':');
  const colon = relativeColon >= 0 ? bodyStart + relativeColon : -1;
  const key = colon >= 0 ? query.slice(bodyStart, colon).trim().toLowerCase() : '';

  return { start: span.start, end: span.end, bodyStart, negated, key, colon };
}

/** Lowercase similarity score: 1 = value prefix, 4 = label substring. */
function matchScore(term: string, values: readonly string[]): number | null {
  if (term.length === 0) return 0;

  let best: number | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = (values[index] ?? '').toLowerCase();

    if (value.startsWith(term)) {
      const score = index === 0 ? 1 : 2;
      if (best === null || score < best) best = score;
      continue;
    }

    if (value.includes(term)) {
      const score = index === 0 ? 3 : 4;
      if (best === null || score < best) best = score;
    }
  }

  return best;
}

function rankSuggestions(candidates: readonly RankedCandidate[], term: string): SearchSuggestion[] {
  const scored: ScoredCandidate[] = [];

  candidates.forEach((candidate, order) => {
    const score = matchScore(term, candidate.match);
    if (score === null) return;
    scored.push({ score, order, suggestion: candidate.suggestion });
  });

  scored.sort((a, b) => a.score - b.score || a.order - b.order);
  return scored.slice(0, MAX_SUGGESTIONS).map((entry) => entry.suggestion);
}

/** Quotes values that contain whitespace so a multi-word token survives parsing. */
function quoteValue(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Unwraps typed quotes and lowercases a partial value for matching. */
function unwrapTypedValue(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('"')) value = value.slice(1);
  if (value.endsWith('"')) value = value.slice(0, -1);
  return value.trim().toLowerCase();
}

function readSeasons(catalog: SearchAutocompleteCatalog): FilterOption[] {
  const raw: unknown = catalog.seasons;
  if (!Array.isArray(raw)) return [];

  const seasons: FilterOption[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const value = record.value;
    const label = record.label;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (typeof label !== 'string' || label.trim().length === 0) continue;
    const count = record.count;
    seasons.push({
      value,
      label: label.trim(),
      ...(typeof count === 'number' && Number.isFinite(count) ? { count } : {}),
    });
  }
  return seasons;
}

function readSources(catalog: SearchAutocompleteCatalog): SearchAutocompleteSource[] {
  const raw: unknown = catalog.sources;
  if (!Array.isArray(raw)) return [];

  const sources: SearchAutocompleteSource[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (key.length === 0 || label.length === 0) continue;

    const count = record.count;
    const rawAliases = record.aliases;
    const aliases = Array.isArray(rawAliases)
      ? rawAliases
          .filter((alias): alias is string => typeof alias === 'string')
          .map((alias) => alias.trim())
          .filter((alias) => alias.length > 0)
      : [];

    sources.push({
      key,
      label,
      ...(typeof count === 'number' && Number.isFinite(count) ? { count } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }
  return sources;
}

function readCategories(catalog: SearchAutocompleteCatalog): FilterOption[] {
  const raw: unknown = catalog.categories;
  if (!Array.isArray(raw)) return [];

  const categories: FilterOption[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const value = record.value;
    const label = record.label;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (typeof label !== 'string' || label.trim().length === 0) continue;
    const count = record.count;
    categories.push({
      value,
      label: label.trim(),
      ...(typeof count === 'number' && Number.isFinite(count) ? { count } : {}),
    });
  }
  return categories;
}

/**
 * Folds Lite/full duplicates together (InventoryItem appears twice) so table
 * suggestions never list the same short name twice. Loaded tables win.
 */
function dedupeTables(tables: readonly TableStatus[]): TableStatus[] {
  const byShortName = new Map<string, TableStatus>();

  for (const table of tables) {
    const key = normalizeLookup(table.shortName);
    if (key.length === 0) continue;

    const existing = byShortName.get(key);
    if (!existing) {
      byShortName.set(key, table);
      continue;
    }

    const existingRank = existing.loaded ? 2 : existing.loading ? 1 : 0;
    const tableRank = table.loaded ? 2 : table.loading ? 1 : 0;
    if (tableRank > existingRank) byShortName.set(key, table);
  }

  return [...byShortName.values()];
}

function operatorSuggestions(typedKey: string, negated: boolean): SearchSuggestion[] {
  const term = typedKey.trim().toLowerCase();
  if (term.length < 2) return [];

  const prefix = negated ? '-' : '';
  const candidates: RankedCandidate[] = [];

  for (const operator of OPERATOR_SPECS) {
    candidates.push({
      match: [operator.key],
      suggestion: {
        id: `operator:${operator.key}`,
        insert: `${prefix}${operator.key}:`,
        token: `${prefix}${operator.key}:`,
        label: operator.description,
        completesValue: false,
      },
    });
  }

  return rankSuggestions(candidates, term);
}

function valueSuggestions(
  group: ValueGroup,
  key: string,
  negated: boolean,
  typed: string,
  catalog: SearchAutocompleteCatalog,
  tables: readonly TableStatus[],
): SearchSuggestion[] {
  const prefix = negated ? '-' : '';
  const candidates: RankedCandidate[] = [];

  function add(
    valueToken: string,
    label: string,
    match: readonly string[],
    options?: { count?: number; dot?: string; idSuffix?: string },
  ): void {
    const insert = `${prefix}${valueToken}`;
    const count = options?.count;
    candidates.push({
      match,
      suggestion: {
        id: `${group}:${options?.idSuffix ?? valueToken.toLowerCase()}`,
        insert,
        token: insert,
        label,
        ...(count !== undefined && count > 0 ? { count } : {}),
        ...(options?.dot !== undefined ? { dot: options.dot } : {}),
        completesValue: true,
      },
    });
  }

  if (group === 'season') {
    add(`${key}:latest`, 'Latest season', ['latest', 'latest season'], {
      idSuffix: 'latest',
    });

    for (const season of readSeasons(catalog)) {
      const value = String(season.value);
      const dot = season.label.indexOf('·');
      const name = dot >= 0 ? season.label.slice(dot + 1).trim() : season.label;
      add(`${key}:${value}`, season.label, [value, name, season.label], {
        count: season.count,
        idSuffix: value,
      });
    }

    return rankSuggestions(candidates, typed);
  }

  if (group === 'source') {
    const liveSources = readSources(catalog);
    const sources = liveSources.length > 0 ? liveSources : FALLBACK_SOURCES;

    for (const source of sources) {
      add(`${key}:${quoteValue(source.key)}`, source.label, [
        source.key,
        source.label,
        ...(source.aliases ?? []),
      ], { count: source.count, idSuffix: source.key });
    }

    return rankSuggestions(candidates, typed);
  }

  if (group === 'table') {
    const liveTables = dedupeTables(tables);
    const artifactLive = liveTables.find(
      (table) => normalizeLookup(table.shortName) === 'artifactperks',
    );

    add(`${key}:artifactperks`, 'Artifact Perks', ['artifactperks', 'artifact perks'], {
      count: artifactLive?.loaded ? artifactLive.count : undefined,
      idSuffix: 'artifactperks',
    });

    for (const table of liveTables) {
      const normalized = normalizeLookup(table.shortName);
      if (normalized.length === 0 || normalized === 'artifactperks') continue;

      add(`${key}:${normalized}`, table.shortName, [
        normalized,
        table.shortName,
        table.name,
      ], {
        count: table.loaded ? table.count : undefined,
        idSuffix: normalized,
      });
    }

    return rankSuggestions(candidates, typed);
  }

  if (group === 'category') {
    for (const category of readCategories(catalog)) {
      add(`${key}:${quoteValue(category.label)}`, category.label, [category.label], {
        count: category.count,
        idSuffix: category.label,
      });
    }

    return rankSuggestions(candidates, typed);
  }

  for (const option of STATIC_VALUE_OPTIONS[group]) {
    add(`${key}:${option.value}`, option.label, [option.value, option.label], {
      dot: option.dot,
      idSuffix: option.value,
    });
  }

  return rankSuggestions(candidates, typed);
}

/**
 * Builds the suggestions for the token at `caret`. Returns an empty array when
 * the caret is between tokens, the query is empty, or nothing matches.
 */
export function buildSearchSuggestions(
  query: string,
  caret: number,
  catalog: SearchAutocompleteCatalog,
  tables: readonly TableStatus[],
): SearchSuggestion[] {
  const clamped = Math.max(0, Math.min(caret, query.length));
  const token = findActiveToken(query, clamped);
  if (!token) return [];

  if (token.colon >= 0) {
    // The caret is inside the key: complete the operator instead of its value.
    if (clamped <= token.colon) {
      const typedKey = query.slice(token.bodyStart, Math.min(clamped, token.colon));
      return operatorSuggestions(typedKey, token.negated);
    }

    const group = KEY_GROUPS[token.key];
    if (!group) return [];

    const valueEnd = Math.max(token.colon + 1, Math.min(clamped, token.end));
    const typed = unwrapTypedValue(query.slice(token.colon + 1, valueEnd));
    return valueSuggestions(group, token.key, token.negated, typed, catalog, tables);
  }

  const typedKey = query.slice(
    token.bodyStart,
    Math.max(token.bodyStart, Math.min(clamped, token.end)),
  );
  return operatorSuggestions(typedKey, token.negated);
}

/**
 * Replaces only the active token with the suggestion, preserving everything
 * before and after it. Completed `key:value` tokens get one trailing space
 * unless whitespace already follows, and the returned caret sits after the
 * inserted text so the user can keep typing.
 */
export function applySearchSuggestion(
  query: string,
  caret: number,
  suggestion: SearchSuggestion,
): SearchSuggestionResult {
  const clamped = Math.max(0, Math.min(caret, query.length));
  const token = findActiveToken(query, clamped);
  const start = token?.start ?? clamped;
  const end = token?.end ?? clamped;

  const before = query.slice(0, start);
  const after = query.slice(end);
  const needsSpace = suggestion.completesValue && !/^\s/.test(after);
  const insert = needsSpace ? `${suggestion.insert} ` : suggestion.insert;

  return {
    query: `${before}${insert}${after}`,
    caret: before.length + insert.length,
  };
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

/**
 * Composited, keyboard-driven suggestion list for the search bar. The Header
 * owns focus/caret/highlight state; this component only renders the listbox and
 * forwards mouse interaction back through the same accept callback.
 */
export function SearchAutocomplete({
  id,
  suggestions,
  highlightIndex,
  onHighlight,
  onAccept,
}: SearchAutocompleteProps): ReactNode {
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the keyboard-highlighted row inside the capped, scrollable panel.
  useEffect(() => {
    if (highlightIndex < 0) return;
    const list = listRef.current;
    const option = list?.children.item(highlightIndex);
    if (option instanceof HTMLElement) {
      option.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [highlightIndex, suggestions]);

  if (suggestions.length === 0) return null;

  return (
    <div className={styles.panel}>
      <div
        ref={listRef}
        className={styles.list}
        role="listbox"
        id={`${id}-list`}
        aria-label="Search suggestions"
      >
        {suggestions.map((suggestion, index) => {
          const active = index === highlightIndex;
          return (
            <div
              key={suggestion.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={active}
              className={cx(styles.option, active && styles.optionActive)}
              title={`${suggestion.insert} — ${suggestion.label}`}
              onMouseDown={(event) => {
                // Keep focus in the search input while accepting the click.
                event.preventDefault();
                onAccept(suggestion);
              }}
              onMouseEnter={() => onHighlight(index)}
            >
              {suggestion.dot !== undefined ? (
                <span
                  className={styles.dot}
                  style={{ background: suggestion.dot }}
                  aria-hidden="true"
                />
              ) : (
                <span className={styles.dotSpacer} aria-hidden="true" />
              )}
              <span className={styles.token}>{suggestion.token}</span>
              <span className={styles.label}>{suggestion.label}</span>
              {suggestion.count !== undefined && (
                <span className={styles.count}>{NUMBER_FORMAT.format(suggestion.count)}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className={styles.footer} aria-hidden="true">
        <span>↑↓ navigate</span>
        <span>·</span>
        <span>Tab/Enter insert</span>
        <span>·</span>
        <span>Esc dismiss</span>
      </div>
    </div>
  );
}
