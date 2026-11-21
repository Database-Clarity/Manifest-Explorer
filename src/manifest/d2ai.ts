/**
 * DIM d2-additional-info mappings.
 *
 * The four JSON snapshots under ./d2ai are bundled as zero-latency defaults so
 * season resolution, craftable detection, and artifact-perk parent metadata all
 * work immediately on first boot and while offline. A non-blocking background
 * refresh merges newer entries in later so Season 29+ keeps working without a
 * rebuild.
 */

import watermarkToSeasonRaw from './d2ai/watermark-to-season.json';
import itemHashToSeasonRaw from './d2ai/seasons.json';
import sourceHashToSeasonRaw from './d2ai/source-to-season-v2.json';
import craftableHashesRaw from './d2ai/craftable-hashes.json';

export interface D2aiMappings {
  /** watermark icon path -> season number (1-based). */
  watermarkToSeason: Record<string, number>;
  /** inventory item hash string -> season number (1-based). */
  itemHashToSeason: Record<string, number>;
  /** collectible source hash string -> season number (1-based). */
  sourceHashToSeason: Record<string, number>;
  /** Craftable weapon hashes. */
  craftableHashes: Set<number>;
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

/** Live/merged mappings. Mutated in place by the background refresh. */
const mappings: D2aiMappings = {
  watermarkToSeason: { ...watermarkToSeasonRaw },
  itemHashToSeason: { ...itemHashToSeasonRaw },
  sourceHashToSeason: { ...sourceHashToSeasonRaw },
  craftableHashes: new Set<number>(craftableHashesRaw),
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
