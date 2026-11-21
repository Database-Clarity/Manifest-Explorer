/**
 * DIM d2-additional-info mappings.
 *
 * The five JSON snapshots under ./d2ai are bundled as zero-latency defaults so
 * season resolution, craftable detection, source-tag resolution and
 * artifact-perk parent metadata all work immediately on first boot and while
 * offline. A non-blocking background refresh merges newer entries in later so
 * Season 29+ keeps working without a rebuild.
 */

import watermarkToSeasonRaw from './d2ai/watermark-to-season.json';
import itemHashToSeasonRaw from './d2ai/seasons.json';
import sourceHashToSeasonRaw from './d2ai/source-to-season-v2.json';
import craftableHashesRaw from './d2ai/craftable-hashes.json';
import sourceInfoRaw from './d2ai/source-info-v2.json';

/** A single DIM D2Sources entry (keyed by canonical source key). */
export interface D2SourceEntry {
  itemHashes?: number[];
  sourceHashes?: number[];
  aliases?: string[];
  enteredDCV?: number;
}

export interface D2aiMappings {
  /** watermark icon path -> season number (1-based). */
  watermarkToSeason: Record<string, number>;
  /** inventory item hash string -> season number (1-based). */
  itemHashToSeason: Record<string, number>;
  /** collectible source hash string -> season number (1-based). */
  sourceHashToSeason: Record<string, number>;
  /** Craftable weapon hashes. */
  craftableHashes: Set<number>;
  /** inventory item hash -> canonical DIM source keys. */
  itemHashToSourceTags: Map<number, string[]>;
  /** collectible source hash -> canonical DIM source keys. */
  sourceHashToSourceTags: Map<number, string[]>;
  /** normalized source key/alias -> canonical DIM source key. */
  sourceAliasToKey: Map<string, string>;
  /** canonical DIM source key -> human-readable label. */
  sourceLabels: Record<string, string>;
  /** canonical DIM source key -> aliases (from the D2Sources snapshot). */
  sourceAliasesByKey: Record<string, string[]>;
}

/** Lowercase and strip all whitespace/punctuation for source lookups. */
export function normalizeSourceLookup(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Drop "Season of [the]", "Episode:" and "Season:" prefixes from a season name. */
export function formatShortSeasonName(rawName: string): string {
  return rawName
    .trim()
    .replace(/^Season of the\s+/i, '')
    .replace(/^Season of\s+/i, '')
    .replace(/^Episode:\s*/i, '')
    .replace(/^Season:\s*/i, '')
    .trim();
}

const REMOTE_BASE_URL =
  'https://raw.githubusercontent.com/DestinyItemManager/d2-additional-info/master/output/';

type RecordKey = 'watermarkToSeason' | 'itemHashToSeason' | 'sourceHashToSeason';

const RECORD_FILES: ReadonlyArray<{ file: string; key: RecordKey }> = [
  { file: 'watermark-to-season.json', key: 'watermarkToSeason' },
  { file: 'seasons.json', key: 'itemHashToSeason' },
  { file: 'source-to-season-v2.json', key: 'sourceHashToSeason' },
];

const CRAFTABLE_FILE = 'craftable-hashes.json';

/** Human-readable labels for every official DIM D2Sources key. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  '30th': '30th Anniversary',
  adventure: 'Adventure',
  avalon: 'Avalon',
  battlegrounds: 'Battlegrounds',
  blackarmory: 'Black Armory',
  brave: 'BRAVE Arsenal',
  calus: 'Calus',
  campaign: 'Campaign',
  cayde6: 'Cayde-6',
  charity: 'Charity',
  compass: 'Compass',
  conquest: 'Conquest',
  contact: 'Contact',
  cosmodrome: 'Cosmodrome',
  crotasend: "Crota's End",
  crownofsorrow: 'Crown of Sorrow',
  crucible: 'Crucible',
  deepstonecrypt: 'Deep Stone Crypt',
  deluxe: 'Deluxe',
  desertperpetual: 'Desert Perpetual',
  do: 'Dead Orbit',
  dreaming: 'Dreaming City',
  duality: 'Duality',
  dungeon: 'Dungeon',
  echoes: 'Echoes',
  edgeoffate: 'Edge of Fate',
  edz: 'EDZ',
  eow: 'Eater of Worlds',
  ep: 'Escalation Protocol',
  equilibrium: 'Equilibrium',
  europa: 'Europa',
  events: 'Events',
  eververse: 'Eververse',
  evidenceboard: 'Evidence Board',
  exoticquest: 'Exotic Mission / Quest',
  fwc: 'Future War Cult',
  gambit: 'Gambit',
  gambitprime: 'Gambit Prime',
  gardenofsalvation: 'Garden of Salvation',
  ghostsofthedeep: 'Ghosts of the Deep',
  grasp: 'Grasp of Avarice',
  gunsmith: 'Gunsmith',
  harbinger: 'Harbinger',
  haunted: 'Haunted',
  heliostat: 'Heliostat',
  heresy: 'Heresy',
  ikora: 'Ikora',
  intothelight: 'Into the Light',
  io: 'Io',
  ironbanner: 'Iron Banner',
  kepler: 'Kepler',
  kingsfall: "King's Fall",
  lastwish: 'Last Wish',
  legendaryengram: 'World Drops',
  leviathan: 'Leviathan',
  lost: 'Lost',
  lostsectors: 'Lost Sectors',
  mars: 'Mars',
  menagerie: 'Menagerie',
  mercury: 'Mercury',
  monumentoftriumph: 'Monument of Triumph',
  moon: 'Moon',
  neomuna: 'Neomuna',
  nessus: 'Nessus',
  nightfall: 'Nightfall',
  nightmare: 'Nightmare',
  nm: 'New Monarchy',
  oblation: 'Oblation',
  paleheart: 'The Pale Heart',
  pantheon: 'Pantheon',
  'pinnacle-weapon': 'Pinnacle Weapon',
  pinnacleops: 'Pinnacle Ops',
  pit: 'Pit of Heresy',
  plunder: 'Plunder',
  presage: 'Presage',
  prestige: 'Prestige',
  prophecy: 'Prophecy',
  psiops: 'PsiOps Battlegrounds',
  rahool: 'Rahool',
  raid: 'Raid',
  rasputin: 'Rasputin',
  reclaim: 'Reclaim',
  renegades: 'Renegades',
  revenant: 'Revenant',
  riteofthenine: 'Rite of the Nine',
  'ritual-weapon': 'Ritual Weapon',
  rivenslair: "Riven's Lair",
  rootofnightmares: 'Root of Nightmares',
  saint14: 'Saint-14',
  salvationsedge: "Salvation's Edge",
  scourgeofthepast: 'Scourge of the Past',
  seasonpass: 'Season Pass',
  servitor: 'Servitor',
  shatteredthrone: 'Shattered Throne',
  shipwright: 'Shipwright',
  sonar: 'Sonar',
  sparrowracingleague: 'SRL',
  spireofstars: 'Spire of Stars',
  spireofthewatcher: 'Spire of the Watcher',
  strikes: 'Strikes / Vanguard',
  sundereddoctrine: 'Sundered Doctrine',
  sundial: 'Sundial',
  tangled: 'Tangled Shore',
  throneworld: 'Throne World',
  titan: 'Titan',
  trials: 'Trials of Osiris',
  umbral: 'Umbral',
  vaultofglass: 'Vault of Glass',
  vespershost: "Vesper's Host",
  vexoffensive: 'Vex Offensive',
  vowofthedisciple: 'Vow of the Disciple',
  warlordsruin: "Warlord's Ruin",
  wartable: 'War Table',
  wellspring: 'Wellspring',
  wrathborn: 'Wrathborn',
};

/** Additional canonical aliases that are not present in the D2Sources snapshot. */
const EXTRA_SOURCE_ALIASES: Readonly<Record<string, string>> = {
  ib: 'ironbanner',
  se: 'salvationsedge',
  vanguard: 'strikes',
  exoticmission: 'exoticquest',
  world: 'legendaryengram',
  worlddrop: 'legendaryengram',
  trialsofosiris: 'trials',
};

/** Clean title-case fallback for any source key without an explicit label. */
function capitalizeSourceLabel(key: string): string {
  return key
    .split(/[^a-zA-Z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function pushSourceTag(map: Map<number, string[]>, hash: number, key: string): void {
  const existing = map.get(hash);
  if (existing) {
    if (!existing.includes(key)) existing.push(key);
  } else {
    map.set(hash, [key]);
  }
}

/** Build the source tag + alias maps once from the bundled D2Sources snapshot. */
function buildSourceMappings(): {
  itemHashToSourceTags: Map<number, string[]>;
  sourceHashToSourceTags: Map<number, string[]>;
  sourceAliasToKey: Map<string, string>;
  sourceLabels: Record<string, string>;
  sourceAliasesByKey: Record<string, string[]>;
} {
  const itemHashToSourceTags = new Map<number, string[]>();
  const sourceHashToSourceTags = new Map<number, string[]>();
  const sourceAliasToKey = new Map<string, string>();
  const sourceLabels: Record<string, string> = {};
  const sourceAliasesByKey: Record<string, string[]> = {};

  const raw = sourceInfoRaw as Record<string, D2SourceEntry>;

  for (const [key, entry] of Object.entries(raw)) {
    sourceLabels[key] = SOURCE_LABELS[key] ?? capitalizeSourceLabel(key);

    if (entry.itemHashes) {
      for (const hash of entry.itemHashes) {
        if (!Number.isFinite(hash)) continue;
        pushSourceTag(itemHashToSourceTags, hash, key);
      }
    }

    if (entry.sourceHashes) {
      for (const hash of entry.sourceHashes) {
        if (!Number.isFinite(hash)) continue;
        pushSourceTag(sourceHashToSourceTags, hash, key);
      }
    }

    const aliases = entry.aliases ?? [];
    sourceAliasesByKey[key] = aliases;
    for (const alias of [key, ...aliases]) {
      const normalized = normalizeSourceLookup(alias);
      if (normalized && !sourceAliasToKey.has(normalized)) {
        sourceAliasToKey.set(normalized, key);
      }
      const lowered = alias.toLowerCase();
      if (lowered && !sourceAliasToKey.has(lowered)) {
        sourceAliasToKey.set(lowered, key);
      }
    }
  }

  for (const [alias, canonical] of Object.entries(EXTRA_SOURCE_ALIASES)) {
    const normalized = normalizeSourceLookup(alias);
    if (normalized && !sourceAliasToKey.has(normalized)) {
      sourceAliasToKey.set(normalized, canonical);
    }
    if (!sourceAliasToKey.has(alias)) sourceAliasToKey.set(alias, canonical);
  }

  return {
    itemHashToSourceTags,
    sourceHashToSourceTags,
    sourceAliasToKey,
    sourceLabels,
    sourceAliasesByKey,
  };
}

const sourceMappings = buildSourceMappings();

/** Live/merged mappings. Mutated in place by the background refresh. */
const mappings: D2aiMappings = {
  watermarkToSeason: { ...watermarkToSeasonRaw },
  itemHashToSeason: { ...itemHashToSeasonRaw },
  sourceHashToSeason: { ...sourceHashToSeasonRaw },
  craftableHashes: new Set<number>(craftableHashesRaw),
  itemHashToSourceTags: sourceMappings.itemHashToSourceTags,
  sourceHashToSourceTags: sourceMappings.sourceHashToSourceTags,
  sourceAliasToKey: sourceMappings.sourceAliasToKey,
  sourceLabels: sourceMappings.sourceLabels,
  sourceAliasesByKey: sourceMappings.sourceAliasesByKey,
};

export function getD2aiMappings(): D2aiMappings {
  return mappings;
}

async function mergeRecordFile(
  file: string,
  target: Record<string, number>,
  signal: AbortSignal,
): Promise<boolean> {
  const res = await fetch(`${REMOTE_BASE_URL}${file}`, { signal });
  if (!res.ok) return false;
  const record = (await res.json()) as Record<string, number>;
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return false;

  let added = false;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (target[key] === undefined) {
      target[key] = value;
      added = true;
    }
  }
  return added;
}

async function mergeCraftableHashes(signal: AbortSignal): Promise<boolean> {
  const res = await fetch(`${REMOTE_BASE_URL}${CRAFTABLE_FILE}`, { signal });
  if (!res.ok) return false;
  const values = (await res.json()) as number[];
  if (!Array.isArray(values)) return false;

  let added = false;
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (!mappings.craftableHashes.has(value)) {
      mappings.craftableHashes.add(value);
      added = true;
    }
  }
  return added;
}

/**
 * Non-blocking background fetch that merges newer mappings into memory. Fails
 * silently (network errors, timeouts and malformed payloads all resolve false)
 * and returns true when at least one new entry was added.
 */
export async function refreshD2aiMappingsFromRemote(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const results = await Promise.allSettled([
      ...RECORD_FILES.map(({ file, key }) => mergeRecordFile(file, mappings[key], controller.signal)),
      mergeCraftableHashes(controller.signal),
    ]);
    return results.some((result) => result.status === 'fulfilled' && result.value);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback season names and aliases for Destiny 2 seasons 1..28. Used to
 * resolve `season:<name>` queries (including `season:renegades`, `season:edge of
 * fate`, `season:final shape`, `season:heresy`) and to backfill a blank Season 1
 * name with "Red War".
 */
export const SEASON_ALIASES: Readonly<
  Record<number, { fallbackName: string; aliases: readonly string[] }>
> = {
  1: { fallbackName: 'Red War', aliases: ['red war'] },
  2: { fallbackName: 'Curse of Osiris', aliases: ['curse of osiris', 'osiris'] },
  3: { fallbackName: 'Warmind', aliases: ['warmind', 'resurgence'] },
  4: { fallbackName: 'Forsaken', aliases: ['forsaken', 'outlaw'] },
  5: { fallbackName: 'Black Armory', aliases: ['black armory', 'forge'] },
  6: { fallbackName: "Joker's Wild", aliases: ['drifters', 'jokers wild'] },
  7: { fallbackName: 'Opulence', aliases: ['opulence'] },
  8: { fallbackName: 'Undying', aliases: ['shadowkeep', 'undying'] },
  9: { fallbackName: 'Dawn', aliases: ['dawn'] },
  10: { fallbackName: 'Worthy', aliases: ['worthy'] },
  11: { fallbackName: 'Arrivals', aliases: ['arrivals'] },
  12: { fallbackName: 'Hunt', aliases: ['beyond light', 'hunt'] },
  13: { fallbackName: 'Chosen', aliases: ['chosen'] },
  14: { fallbackName: 'Splicer', aliases: ['splicer'] },
  15: { fallbackName: 'Lost', aliases: ['lost'] },
  16: { fallbackName: 'Risen', aliases: ['witch queen', 'risen'] },
  17: { fallbackName: 'Haunted', aliases: ['haunted'] },
  18: { fallbackName: 'Plunder', aliases: ['plunder'] },
  19: { fallbackName: 'Seraph', aliases: ['seraph'] },
  20: { fallbackName: 'Defiance', aliases: ['lightfall', 'defiance'] },
  21: { fallbackName: 'Deep', aliases: ['deep'] },
  22: { fallbackName: 'Witch', aliases: ['witch'] },
  23: { fallbackName: 'Wish', aliases: ['wish'] },
  24: { fallbackName: 'Echoes', aliases: ['final shape', 'echoes'] },
  25: { fallbackName: 'Revenant', aliases: ['revenant'] },
  26: { fallbackName: 'Heresy', aliases: ['heresy'] },
  27: { fallbackName: 'Edge of Fate', aliases: ['edge of fate', 'reclamation'] },
  28: {
    fallbackName: 'Renegades',
    aliases: ['renegades', 'lawless', 'monument of triumph'],
  },
};
