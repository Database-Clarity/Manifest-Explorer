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
import { normalizeSourceLookup } from './d2ai';
import { ARTIFACT_PERKS_TABLE, TABLE_METADATA, getShortTableName, resolveTableAlias } from './tables';

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
}

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
  pattern: 'craftable',
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

type ValueAliasKind = 'tier' | 'damage' | 'class' | 'type' | 'ammo';

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
  const ammoFilters: number[] = [];
  const slotFilters: number[] = [];
  const subtypeFilters: number[] = [];
  const categoryTokens: string[] = [];
  const seasonFilters: string[] = [];
  const sourceTokens: string[] = [];
  const negatedSourceTokens: string[] = [];
  const traitTokens: string[] = [];
  const negatedTraitTokens: string[] = [];
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

        case 'ammo': {
          if (negated) break;
          const ammo = resolveAmmo(value);
          if (ammo !== null) pushUniqueNumber(ammoFilters, ammo);
          break;
        }

        case 'slot': {
          if (negated) break;
          const slot = resolveSlot(value);
          if (slot !== null) pushUniqueNumber(slotFilters, slot);
          break;
        }

        case 'subtype':
        case 'weapon': {
          if (negated) break;
          const subtype = resolveSubtype(value);
          if (subtype !== null) pushUniqueNumber(subtypeFilters, subtype);
          break;
        }

        case 'season':
        case 's': {
          if (negated) break;
          pushUnique(seasonFilters, normalizePhrase(value));
          break;
        }

        case 'source': {
          const phrase = normalizePhrase(value);
          if (!phrase) break;
          if (negated) pushUnique(negatedSourceTokens, phrase);
          else pushUnique(sourceTokens, phrase);
          break;
        }

        case 'trait': {
          const phrase = normalizePhrase(value);
          if (!phrase) break;
          if (negated) pushUnique(negatedTraitTokens, phrase);
          else pushUnique(traitTokens, phrase);
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
          const normalized = value.toLowerCase().replace(/[^a-z]/g, '');
          const flagKey = FLAG_TOKENS[normalized];
          if (flagKey) {
            flags[flagKey] = !negated;
          } else {
            const alias = IS_VALUE_ALIASES[normalized];
            if (alias && !negated) {
              switch (alias.kind) {
                case 'tier':
                  pushUniqueNumber(tierFilters, alias.value);
                  break;
                case 'damage':
                  pushUniqueNumber(damageFilters, alias.value);
                  break;
                case 'class':
                  pushUniqueNumber(classFilters, alias.value);
                  break;
                case 'type':
                  pushUniqueNumber(typeFilters, alias.value);
                  break;
                case 'ammo':
                  pushUniqueNumber(ammoFilters, alias.value);
                  break;
              }
            }
          }
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
    ammoFilters,
    slotFilters,
    subtypeFilters,
    categoryTokens,
    seasonFilters,
    sourceTokens,
    negatedSourceTokens,
    traitTokens,
    negatedTraitTokens,
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
  if (entry.parentArtifactName && entry.parentArtifactName.toLowerCase().includes(token)) return 40;
  if (entry.descLower.includes(token)) return 20;
  return 0;
}

function textMatches(entry: SearchIndexEntry, token: string): boolean {
  return (
    entry.nameLower.includes(token) ||
    entry.subtitleLower.includes(token) ||
    entry.descLower.includes(token) ||
    (entry.parentArtifactName !== undefined && entry.parentArtifactName.toLowerCase().includes(token))
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

function sourceMatches(entry: SearchIndexEntry, token: string, context?: SearchContext): boolean {
  if (!token) return false;
  const norm = normalizeSourceLookup(token);
  const canonical = context?.sourceAliasToKey?.get(norm);
  if (canonical && entry.sourceTags?.includes(canonical) === true) return true;
  if (
    norm.length >= 3 &&
    entry.sourceTags?.some((tag) => tag === norm || tag.includes(norm)) === true
  ) {
    return true;
  }
  if (entry.sourceLower?.includes(token) === true) return true;
  return entry.descLower.includes(token);
}

function traitMatches(entry: SearchIndexEntry, token: string): boolean {
  if (!token) return false;
  return entry.traitIds?.some((trait) => trait.includes(token)) === true;
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
  if (entry.isArtifactPerk !== undefined) item.isArtifactPerk = entry.isArtifactPerk;
  if (entry.parentArtifactHash !== undefined) item.parentArtifactHash = entry.parentArtifactHash;
  if (entry.parentArtifactName !== undefined) item.parentArtifactName = entry.parentArtifactName;
  if (entry.parentArtifactIcon !== undefined) item.parentArtifactIcon = entry.parentArtifactIcon;
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
  context?: SearchContext,
): SearchResponse {
  const startedAt = Date.now();

  const parsedTableKey = parsed.tableFilter ? tableKey(parsed.tableFilter) : undefined;
  const uiTableKey =
    uiFilters.table && uiFilters.table !== 'all' && uiFilters.table !== ''
      ? tableKey(uiFilters.table)
      : undefined;
  const artifactPerksKey = tableKey(ARTIFACT_PERKS_TABLE);

  // The virtual ArtifactPerks table matches artifact perk entries regardless of
  // their underlying InventoryItem table.
  const matchesTableKey = (entry: SearchIndexEntry, key: string): boolean =>
    key === artifactPerksKey ? entry.isArtifactPerk === true : tableKey(entry.table) === key;

  const hasHashFilter = parsed.hashMatches.length > 0;
  const hashSet = hasHashFilter ? new Set(parsed.hashMatches) : undefined;
  const selectedCategories = uiFilters.itemCategoryHashes.filter((hash) => hash !== 0);
  const seasonNumbers = resolveSeasonNumbers(parsed.seasonFilters, context);

  const flagKeys = Object.keys(parsed.flags) as FlagKey[];

  const scored: ScoredEntry[] = [];

  for (const entry of entries) {
    if (parsedTableKey && !matchesTableKey(entry, parsedTableKey)) continue;
    if (uiTableKey && !matchesTableKey(entry, uiTableKey)) continue;

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
    if (parsed.ammoFilters.length > 0) {
      if (entry.ammoType === undefined || !parsed.ammoFilters.includes(entry.ammoType)) continue;
    }
    if (parsed.slotFilters.length > 0) {
      if (entry.bucketHash === undefined || !parsed.slotFilters.includes(entry.bucketHash)) continue;
    }
    if (parsed.subtypeFilters.length > 0) {
      if (entry.itemSubType === undefined || !parsed.subtypeFilters.includes(entry.itemSubType)) continue;
    }
    if (seasonNumbers) {
      if (entry.seasonNumber === undefined || !seasonNumbers.has(entry.seasonNumber)) continue;
    }

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

    for (const token of parsed.sourceTokens) {
      if (!sourceMatches(entry, token, context)) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    for (const token of parsed.negatedSourceTokens) {
      if (sourceMatches(entry, token, context)) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    for (const token of parsed.traitTokens) {
      if (!traitMatches(entry, token)) {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;

    for (const token of parsed.negatedTraitTokens) {
      if (traitMatches(entry, token)) {
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
