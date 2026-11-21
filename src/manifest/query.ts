import type {
  SearchFilters,
  SearchIndexEntry,
  SearchResponse,
  SearchResultItem,
  SortMode,
} from '../types/manifest';
import {
  CLASS_FILTER_OPTIONS,
  DAMAGE_FILTER_OPTIONS,
  TIER_FILTER_OPTIONS,
} from './enums';
import { parseHashInput } from './hash';
import { TABLE_METADATA, getShortTableName, resolveTableAlias } from './tables';

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
  /** Lowercased category name fragments from cat:/category:. */
  categoryTokens: string[];
  flags: SearchFlags;
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
};

const TOKEN_RE = /(?:[^\s",;]+|"[^"]*")+/g;

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
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

function looksLikeHashToken(value: string): boolean {
  const token = value.replace(/^#/, '');
  return /^[+-]?0x[0-9a-f]+$/i.test(token) || /^[+-]?\d{6,10}$/.test(token);
}

/**
 * Parse a search box query into structured filters. Unsupported prefixes are
 * treated as plain text so nothing typed by the user silently disappears.
 */
export function parseSearchQuery(raw: string, availableTables: string[]): ParsedQuery {
  const textTokens: string[] = [];
  const negatedTokens: string[] = [];
  const hashMatches: number[] = [];
  const tierFilters: number[] = [];
  const damageFilters: number[] = [];
  const classFilters: number[] = [];
  const typeFilters: number[] = [];
  const categoryTokens: string[] = [];
  const flags: SearchFlags = {};

  let tableFilter: string | undefined;
  const matches = raw.match(TOKEN_RE) ?? [];

  for (const rawToken of matches) {
    const token = rawToken.trim();
    if (!token) continue;

    // A negative number can be a signed hash; check that before negation.
    const directHash = looksLikeHashToken(token) ? parseHashInput(token) : null;
    if (directHash !== null) {
      pushUniqueNumber(hashMatches, directHash);
      continue;
    }

    let body = token;
    let negated = false;
    if (body.startsWith('-') && body.length > 1) {
      negated = true;
      body = body.slice(1);
    }

    const colon = body.indexOf(':');
    if (colon > 0) {
      const key = body.slice(0, colon).trim().toLowerCase();
      const value = stripQuotes(body.slice(colon + 1)).trim();

      if (!value) continue;

      switch (key) {
        case 't':
        case 'table': {
          if (negated) break;
          // Before the manifest has loaded, resolve against the known catalog so
          // the parsed query still carries a canonical table name.
          const scope = availableTables.length > 0 ? availableTables : Object.keys(TABLE_METADATA);
          const resolved = resolveTableAlias(value, scope);
          if (resolved) {
            tableFilter = resolved;
          } else if (/^Destiny[A-Za-z0-9]+Definition$/.test(value)) {
            tableFilter = value;
          }
          break;
        }

        case 'tier':
        case 'rarity': {
          if (negated) break;
          const tier = resolveTier(value);
          if (tier !== null) pushUniqueNumber(tierFilters, tier);
          break;
        }

        case 'damage':
        case 'element':
        case 'el':
        case 'dmg': {
          if (negated) break;
          const damage = resolveDamage(value);
          if (damage !== null) pushUniqueNumber(damageFilters, damage);
          break;
        }

        case 'class': {
          if (negated) break;
          const classType = resolveClass(value);
          if (classType !== null) pushUniqueNumber(classFilters, classType);
          break;
        }

        case 'type': {
          if (negated) break;
          const itemType = resolveItemType(value);
          if (itemType !== null) pushUniqueNumber(typeFilters, itemType);
          break;
        }

        case 'cat':
        case 'category':
        case 'categories': {
          if (negated) break;
          pushUnique(categoryTokens, normalizePhrase(value));
          break;
        }

        case 'is':
        case 'has': {
          const flagKey = FLAG_TOKENS[value.toLowerCase().replace(/[^a-z]/g, '')];
          if (flagKey) flags[flagKey] = !negated;
          break;
        }

        case 'hash':
        case 'h': {
          if (negated) break;
          const hash = parseHashInput(value);
          if (hash !== null) pushUniqueNumber(hashMatches, hash);
          break;
        }

        default: {
          const phrase = normalizePhrase(negated ? body : token);
          if (!phrase) break;
          if (negated) pushUnique(negatedTokens, phrase);
          else pushUnique(textTokens, phrase);
          break;
        }
      }
      continue;
    }

    const phrase = normalizePhrase(body);
    if (!phrase) continue;

    if (looksLikeHashToken(phrase)) {
      const hash = parseHashInput(phrase);
      if (hash !== null) {
        pushUniqueNumber(hashMatches, hash);
        continue;
      }
    }

    if (negated) pushUnique(negatedTokens, phrase);
    else pushUnique(textTokens, phrase);
  }

  const parsed: ParsedQuery = {
    textTokens,
    negatedTokens,
    hashMatches,
    tierFilters,
    damageFilters,
    classFilters,
    typeFilters,
    categoryTokens,
    flags,
  };
  if (tableFilter) parsed.tableFilter = tableFilter;
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Ranking and filtering                                                      */
/* -------------------------------------------------------------------------- */

interface ScoredEntry {
  entry: SearchIndexEntry;
  score: number;
}

function hasWordBoundary(haystack: string, needle: string): boolean {
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? '' : haystack.charAt(index - 1);
    const afterIndex = index + needle.length;
    const after = afterIndex >= haystack.length ? '' : haystack.charAt(afterIndex);
    const beforeOk = before === '' || !/[a-z0-9]/.test(before);
    const afterOk = after === '' || !/[a-z0-9]/.test(after);
    if (beforeOk && afterOk) return true;
    index = haystack.indexOf(needle, index + 1);
  }
  return false;
}

function scoreToken(entry: SearchIndexEntry, token: string): number {
  if (!token) return 0;
  if (entry.nameLower === token) return 500;
  if (entry.nameLower.startsWith(token)) return 300;
  if (hasWordBoundary(entry.nameLower, token)) return 200;
  if (entry.nameLower.includes(token)) return 100;
  if (entry.subtitleLower.includes(token)) return 50;
  if (entry.descLower.includes(token)) return 20;
  return 0;
}

function textMatches(entry: SearchIndexEntry, token: string): boolean {
  return (
    entry.nameLower.includes(token) ||
    entry.subtitleLower.includes(token) ||
    entry.descLower.includes(token)
  );
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
    default:
      return false;
  }
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
  return values.some((value) => matchesTypeValue(entry, value));
}

function tableKey(table: string): string {
  return getShortTableName(table).toLowerCase();
}

function resolveCategoryNames(
  entry: SearchIndexEntry,
  categoryNameMap: Map<number, string>,
): string[] | undefined {
  if (!entry.itemCategoryHashes || entry.itemCategoryHashes.length === 0) return undefined;
  const names: string[] = [];
  for (const hash of entry.itemCategoryHashes) {
    const name = categoryNameMap.get(hash);
    if (name) names.push(name.toLowerCase());
  }
  return names.length > 0 ? names : undefined;
}

function categoryMatches(entry: SearchIndexEntry, tokens: readonly string[], map: Map<number, string>): boolean {
  if (tokens.length === 0) return true;
  const names = resolveCategoryNames(entry, map);
  if (!names) return false;
  return tokens.every((token) => names.some((name) => name.includes(token)));
}

function compareNames(a: SearchIndexEntry, b: SearchIndexEntry): number {
  if (!a.name && !b.name) return a.hash - b.hash;
  if (!a.name) return 1;
  if (!b.name) return -1;
  return a.nameLower.localeCompare(b.nameLower);
}

function toResult(entry: SearchIndexEntry): SearchResultItem {
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
  return item;
}

/**
 * Apply structured text filters plus the UI filter popover, rank the survivors
 * and return a capped response.
 */
export function scoreAndFilterEntries(
  entries: SearchIndexEntry[],
  parsed: ParsedQuery,
  uiFilters: SearchFilters,
  sort: SortMode,
  categoryNameMap: Map<number, string>,
  maxResults?: number,
): SearchResponse {
  const startedAt = Date.now();

  const parsedTableKey = parsed.tableFilter ? tableKey(parsed.tableFilter) : undefined;
  const uiTableKey =
    uiFilters.table && uiFilters.table !== 'all' && uiFilters.table !== ''
      ? tableKey(uiFilters.table)
      : undefined;

  const hasHashFilter = parsed.hashMatches.length > 0;
  const hashSet = hasHashFilter ? new Set(parsed.hashMatches) : undefined;
  const selectedCategories = uiFilters.itemCategoryHashes.filter((hash) => hash !== 0);

  const flagKeys = Object.keys(parsed.flags) as FlagKey[];

  const scored: ScoredEntry[] = [];

  for (const entry of entries) {
    if (parsedTableKey && tableKey(entry.table) !== parsedTableKey) continue;
    if (uiTableKey && tableKey(entry.table) !== uiTableKey) continue;

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
    if (
      selectedCategories.length > 0 &&
      (!entry.itemCategoryHashes ||
        !selectedCategories.some((hash) => entry.itemCategoryHashes?.includes(hash)))
    ) {
      continue;
    }
    if (!uiFilters.includeUnnamed && !entry.name) continue;
    if (uiFilters.onlyRedacted && entry.isRedacted !== true) continue;

    if (parsed.tierFilters.length > 0) {
      if (entry.tierType === undefined || !parsed.tierFilters.includes(entry.tierType)) continue;
    }
    if (parsed.damageFilters.length > 0) {
      if (entry.damageType === undefined || !parsed.damageFilters.includes(entry.damageType)) continue;
    }
    if (parsed.classFilters.length > 0) {
      if (entry.classType === undefined || !parsed.classFilters.includes(entry.classType)) continue;
    }
    if (parsed.typeFilters.length > 0 && !matchesAnyType(entry, parsed.typeFilters)) continue;

    let flagMismatch = false;
    for (const key of flagKeys) {
      const expected = parsed.flags[key];
      if (expected === undefined) continue;
      if (entryFlag(entry, key) !== expected) {
        flagMismatch = true;
        break;
      }
    }
    if (flagMismatch) continue;

    if (hashSet) {
      if (!hashSet.has(entry.hash)) continue;
    }

    if (!categoryMatches(entry, parsed.categoryTokens, categoryNameMap)) continue;

    let rejected = false;
    let score = 0;

    for (const token of parsed.textTokens) {
      if (!textMatches(entry, token)) {
        rejected = true;
        break;
      }
      score += scoreToken(entry, token);
    }
    if (rejected) continue;

    for (const token of parsed.negatedTokens) {
      if (textMatches(entry, token)) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    if (hashSet) score += 1000;
    if (entry.name) score += 10;
    if (entry.isDummy) score -= 10;
    else score += 15;

    scored.push({ entry, score });
  }

  scored.sort((a, b) => {
    switch (sort) {
      case 'name-asc':
        return compareNames(a.entry, b.entry) || b.score - a.score;
      case 'name-desc':
        return compareNames(b.entry, a.entry) || b.score - a.score;
      case 'hash-asc':
        return a.entry.hash - b.entry.hash;
      case 'hash-desc':
        return b.entry.hash - a.entry.hash;
      case 'index-desc': {
        const indexDelta = (b.entry.index ?? -1) - (a.entry.index ?? -1);
        return indexDelta || compareNames(a.entry, b.entry);
      }
      case 'relevance':
      default:
        return b.score - a.score || compareNames(a.entry, b.entry) || a.entry.hash - b.entry.hash;
    }
  });

  const totalMatches = scored.length;
  const limited =
    maxResults === undefined || !Number.isFinite(maxResults)
      ? scored
      : scored.slice(0, Math.max(0, maxResults));

  return {
    items: limited.map(({ entry }) => toResult(entry)),
    totalMatches,
    durationMs: Date.now() - startedAt,
  };
}
