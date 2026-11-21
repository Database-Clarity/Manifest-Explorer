/** Utility helpers for Bungie's unsigned 32-bit definition hashes. */

const UINT32_MAX = 0xffffffff;
const MAX_HASH_MAGNITUDE = 4294967295;
const IMAGE_EXTENSION_RE = /\.(png|jpe?g|webp|svg)$/i;
const BUNGIE_ASSET_HOST = 'https://www.bungie.net';

/** Interpret a number as an unsigned 32-bit hash. */
export function toUnsignedHash(n: number): number {
  return n >>> 0;
}

/** Interpret a number as a signed 32-bit hash (as some Bungie SDKs print it). */
export function toSignedHash(n: number): number {
  return n | 0;
}

/**
 * Parse a single hash from user input. Accepts unsigned decimal, signed
 * decimal (including mirror negatives such as -2931081087) and 0x hex.
 */
export function parseHashInput(input: string): number | null {
  let value = input.trim();
  if (!value) return null;

  // Allow the common "hash:123" / "#123" spellings.
  value = value.replace(/^hash:/i, '').replace(/^#/, '').trim();
  if (!value) return null;

  if (/^[+-]?0x[0-9a-f]+$/i.test(value)) {
    const negative = value.startsWith('-');
    const hex = value.replace(/^[+-]/, '').slice(2);
    const magnitude = Number.parseInt(hex, 16);
    if (!Number.isSafeInteger(magnitude) || magnitude > MAX_HASH_MAGNITUDE) return null;
    const signed = negative ? -magnitude : magnitude;
    return signed >>> 0;
  }

  if (!/^[+-]?\d+$/.test(value)) return null;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed < -MAX_HASH_MAGNITUDE || parsed > MAX_HASH_MAGNITUDE) return null;
  return parsed >>> 0;
}

/**
 * Pull every plausible hash out of a pasted list such as
 * "1363886209, 2923251173, -1368098261" or "0x514c2131".
 */
export function extractAllHashesFromQuery(input: string): number[] {
  if (!input.trim()) return [];

  const hashes: number[] = [];
  const seen = new Set<number>();

  for (const part of input.split(/[,\s;|]+/)) {
    const token = part.trim().replace(/^hash:/i, '').replace(/^#/, '').trim();
    if (!token) continue;

    const looksLikeHex = /^[+-]?0x[0-9a-f]+$/i.test(token);
    const looksLikeDecimal = /^[+-]?\d{1,10}$/.test(token);
    if (!looksLikeHex && !looksLikeDecimal) continue;

    const hash = parseHashInput(token);
    if (hash === null || seen.has(hash)) continue;
    seen.add(hash);
    hashes.push(hash);
  }

  return hashes;
}

/**
 * Manifest field name -> Bungie tables that field hashes point at. Fields that
 * can refer to both a perk definition and the plug item get both targets.
 */
export const FIELD_TO_TARGET_TABLE: Record<string, string[]> = {
  collectibleHash: ['DestinyCollectibleDefinition'],
  loreHash: ['DestinyLoreDefinition'],
  iconHash: ['DestinyIconDefinition'],

  defaultDamageTypeHash: ['DestinyDamageTypeDefinition'],
  damageTypeHash: ['DestinyDamageTypeDefinition'],
  damageTypeHashes: ['DestinyDamageTypeDefinition'],
  breakerTypeHash: ['DestinyBreakerTypeDefinition'],
  energyTypeHash: ['DestinyEnergyTypeDefinition'],

  bucketTypeHash: ['DestinyInventoryBucketDefinition'],
  recoveryBucketTypeHash: ['DestinyInventoryBucketDefinition'],
  inventoryBucketHash: ['DestinyInventoryBucketDefinition'],
  tierTypeHash: ['DestinyItemTierTypeDefinition'],

  itemCategoryHashes: ['DestinyItemCategoryDefinition'],
  parentCategoryHashes: ['DestinyItemCategoryDefinition'],
  groupedCategoryHashes: ['DestinyItemCategoryDefinition'],
  categoryHash: ['DestinyItemCategoryDefinition'],

  statHash: ['DestinyStatDefinition'],
  statTypeHash: ['DestinyStatDefinition'],
  capacityStatHash: ['DestinyStatDefinition'],
  costStatHash: ['DestinyStatDefinition'],
  statGroupHash: ['DestinyStatGroupDefinition'],

  socketTypeHash: ['DestinySocketTypeDefinition'],
  socketTypeHashes: ['DestinySocketTypeDefinition'],
  socketCategoryHash: ['DestinySocketCategoryDefinition'],

  reusablePlugSetHash: ['DestinyPlugSetDefinition'],
  randomizedPlugSetHash: ['DestinyPlugSetDefinition'],
  plugSetHash: ['DestinyPlugSetDefinition'],

  singleInitialItemHash: ['DestinyInventoryItemDefinition'],
  plugItemHash: ['DestinyInventoryItemDefinition'],
  plugItemHashes: ['DestinyInventoryItemDefinition'],
  itemHash: ['DestinyInventoryItemDefinition'],
  itemHashes: ['DestinyInventoryItemDefinition'],
  questlineItemHash: ['DestinyInventoryItemDefinition'],
  previewItemHash: ['DestinyInventoryItemDefinition'],
  artifactItemHash: ['DestinyInventoryItemDefinition'],
  catalystItemHash: ['DestinyInventoryItemDefinition'],
  setItems: ['DestinyInventoryItemDefinition'],
  emblemHash: ['DestinyInventoryItemDefinition'],
  materialHash: ['DestinyInventoryItemDefinition'],
  currencyHash: ['DestinyInventoryItemDefinition'],
  rewardItemHash: ['DestinyInventoryItemDefinition'],

  perkHash: ['DestinySandboxPerkDefinition', 'DestinyInventoryItemDefinition'],
  perkHashes: ['DestinySandboxPerkDefinition', 'DestinyInventoryItemDefinition'],
  sandboxPerkHash: ['DestinySandboxPerkDefinition', 'DestinyInventoryItemDefinition'],
  sandboxPerkHashes: ['DestinySandboxPerkDefinition', 'DestinyInventoryItemDefinition'],

  traitHashes: ['DestinyTraitDefinition'],
  traitHash: ['DestinyTraitDefinition'],

  objectiveHash: ['DestinyObjectiveDefinition'],
  objectiveHashes: ['DestinyObjectiveDefinition'],
  completionObjectiveHash: ['DestinyObjectiveDefinition'],

  parentNodeHashes: ['DestinyPresentationNodeDefinition'],
  presentationNodeHash: ['DestinyPresentationNodeDefinition'],
  rootViewHash: ['DestinyPresentationNodeDefinition'],
  sealPresentationNodeHash: ['DestinyPresentationNodeDefinition'],
  seasonalChallengesPresentationNodeHash: ['DestinyPresentationNodeDefinition'],
  childPresentationNodeHash: ['DestinyPresentationNodeDefinition'],

  recordHash: ['DestinyRecordDefinition'],
  recordHashes: ['DestinyRecordDefinition'],
  titleRecordHash: ['DestinyRecordDefinition'],
  metricHash: ['DestinyMetricDefinition'],
  milestoneHash: ['DestinyMilestoneDefinition'],

  activityHash: ['DestinyActivityDefinition'],
  activityHashes: ['DestinyActivityDefinition'],
  directActivityModeHash: ['DestinyActivityModeDefinition'],
  activityModeHash: ['DestinyActivityModeDefinition'],
  activityModeHashes: ['DestinyActivityModeDefinition'],
  activityTypeHash: ['DestinyActivityTypeDefinition'],
  activityGraphHash: ['DestinyActivityGraphDefinition'],
  activityFamilyHashes: ['DestinyActivityFamilyDefinition'],
  activityModifierHash: ['DestinyActivityModifierDefinition'],

  destinationHash: ['DestinyDestinationDefinition'],
  placeHash: ['DestinyPlaceDefinition'],
  factionHash: ['DestinyFactionDefinition'],
  vendorHash: ['DestinyVendorDefinition'],
  vendorGroupHash: ['DestinyVendorGroupDefinition'],
  progressionHash: ['DestinyProgressionDefinition'],
  seasonHash: ['DestinySeasonDefinition'],
  seasonPassHash: ['DestinySeasonPassDefinition'],
  eventCardHash: ['DestinyEventCardDefinition'],
  powerCapHash: ['DestinyPowerCapDefinition'],
  materialRequirementSetHash: ['DestinyMaterialRequirementSetDefinition'],
  unlockHash: ['DestinyUnlockDefinition'],
  acquireUnlockHash: ['DestinyUnlockDefinition'],
  rewardSiteHash: ['DestinyRewardSourceDefinition'],
  equipableItemSetHash: ['DestinyEquipableItemSetDefinition'],
  commendationNodeHash: ['DestinyCommendationNodeDefinition'],
  guardianRankHash: ['DestinyGuardianRankDefinition'],
  loadoutIconHash: ['DestinyLoadoutIconDefinition'],
  loadoutColorHash: ['DestinyLoadoutColorDefinition'],
  loadoutNameHash: ['DestinyLoadoutNameDefinition'],
  artDyeChannelHash: ['DestinyArtDyeChannelDefinition'],
  artDyeHash: ['DestinyArtDyeDefinition'],

  equipmentSlotTypeHash: ['DestinyEquipmentSlotDefinition'],
  talentGridHash: ['DestinyTalentGridDefinition'],
  locationHash: ['DestinyLocationDefinition'],
  locationHashes: ['DestinyLocationDefinition'],
};

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NORMALIZED_FIELD_LOOKUP: ReadonlyMap<string, string[]> = new Map(
  Object.entries(FIELD_TO_TARGET_TABLE).map(([field, tables]) => [normalizeFieldName(field), tables]),
);

/** Contextual hints for a generic "hash" property nested inside a reference object. */
const PARENT_CONTEXT_TABLE: ReadonlyArray<readonly [string, string]> = [
  ['questline', 'DestinyInventoryItemDefinition'],
  ['collectible', 'DestinyCollectibleDefinition'],
  ['lore', 'DestinyLoreDefinition'],
  ['objective', 'DestinyObjectiveDefinition'],
  ['presentationnode', 'DestinyPresentationNodeDefinition'],
  ['node', 'DestinyPresentationNodeDefinition'],
  ['plugset', 'DestinyPlugSetDefinition'],
  ['sockettype', 'DestinySocketTypeDefinition'],
  ['socketcategory', 'DestinySocketCategoryDefinition'],
  ['damagetype', 'DestinyDamageTypeDefinition'],
  ['breakertype', 'DestinyBreakerTypeDefinition'],
  ['energytype', 'DestinyEnergyTypeDefinition'],
  ['statgroup', 'DestinyStatGroupDefinition'],
  ['stat', 'DestinyStatDefinition'],
  ['trait', 'DestinyTraitDefinition'],
  ['record', 'DestinyRecordDefinition'],
  ['metric', 'DestinyMetricDefinition'],
  ['milestone', 'DestinyMilestoneDefinition'],
  ['vendor', 'DestinyVendorDefinition'],
  ['activitymode', 'DestinyActivityModeDefinition'],
  ['activity', 'DestinyActivityDefinition'],
  ['season', 'DestinySeasonDefinition'],
  ['destination', 'DestinyDestinationDefinition'],
  ['place', 'DestinyPlaceDefinition'],
  ['faction', 'DestinyFactionDefinition'],
  ['progression', 'DestinyProgressionDefinition'],
  ['item', 'DestinyInventoryItemDefinition'],
];

/**
 * Resolve the tables a manifest hash field can point at. Falls back to the
 * parent property name for generic `{ hash }` reference objects.
 */
export function getTargetTablesForField(fieldName: string, parentKey?: string): string[] {
  const normalizedField = normalizeFieldName(fieldName);
  if (!normalizedField) return [];

  const direct = NORMALIZED_FIELD_LOOKUP.get(normalizedField);
  if (direct && direct.length > 0) return [...direct];

  if (normalizedField === 'hash' && parentKey) {
    const parent = normalizeFieldName(parentKey);
    for (const [context, table] of PARENT_CONTEXT_TABLE) {
      if (parent.includes(context)) return [table];
    }
  }

  // Handle pluralized fields that are not explicitly listed.
  if (normalizedField.endsWith('hashes')) {
    const singular = normalizedField.slice(0, -'hashes'.length) + 'hash';
    const match = NORMALIZED_FIELD_LOOKUP.get(singular);
    if (match && match.length > 0) return [...match];
  } else if (normalizedField.endsWith('s') && normalizedField.length > 2) {
    const singular = normalizedField.slice(0, -1);
    const match = NORMALIZED_FIELD_LOOKUP.get(singular);
    if (match && match.length > 0) return [...match];
  }

  return direct ? [...direct] : [];
}

/** True when a string looks like a relative Bungie image asset path. */
export function isBungieImagePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path || !IMAGE_EXTENSION_RE.test(path)) return false;
  const lower = path.toLowerCase();
  return lower.startsWith('/common/destiny2_content/') || lower.startsWith('/img/');
}

/** Build an absolute Bungie CDN URL from a relative manifest asset path. */
export function bungieAssetUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return `${BUNGIE_ASSET_HOST}/`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${BUNGIE_ASSET_HOST}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}

/** Range check helper used by callers that accept numeric hash input. */
export function isValidHashNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}
