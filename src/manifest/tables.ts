import type { SearchIndexEntry, TableStatus } from '../types/manifest';

export interface TableMetadata {
  /** Canonical Bungie table name, e.g. DestinyInventoryItemDefinition */
  name: string;
  /** Compact name without Destiny/Definition, e.g. InventoryItem */
  shortName: string;
  /** Human readable name, e.g. Inventory Item */
  friendlyName: string;
  group: TableStatus['group'];
  /** True when this table is the Lite variant of another table */
  isLite?: boolean;
}

/**
 * Tables needed before search can become usable. InventoryItemLite is the
 * reduced payload that Bungie publishes for the fast initial boot.
 */
export const CORE_BOOT_TABLES = [
  'DestinyInventoryItemLiteDefinition',
  'DestinySandboxPerkDefinition',
  'DestinyStatDefinition',
  'DestinyItemCategoryDefinition',
  'DestinyDamageTypeDefinition',
  'DestinyClassDefinition',
  'DestinySocketCategoryDefinition',
  'DestinyBreakerTypeDefinition',
  'DestinyEnergyTypeDefinition',
  'DestinyInventoryBucketDefinition',
  'DestinyItemTierTypeDefinition',
  'DestinyTraitDefinition',
  'DestinySeasonDefinition',
  'DestinyArtifactDefinition',
] as const;

/**
 * Secondary tables are indexed in the background. They do not block the
 * initial search experience but power references, overviews and lore.
 */
export const SECONDARY_INDEX_TABLES = [
  'DestinyCollectibleDefinition',
  'DestinyRecordDefinition',
  'DestinyActivityDefinition',
  'DestinyActivityModifierDefinition',
  'DestinyPresentationNodeDefinition',
  'DestinyPlugSetDefinition',
  'DestinyObjectiveDefinition',
  'DestinyLoreDefinition',
  'DestinyVendorDefinition',
  'DestinySocketTypeDefinition',
  'DestinySeasonDefinition',
  'DestinyArtifactDefinition',
  'DestinyMilestoneDefinition',
  'DestinyDestinationDefinition',
  'DestinyPlaceDefinition',
  'DestinyFactionDefinition',
  'DestinyEquipableItemSetDefinition',
  'DestinyMetricDefinition',
  'DestinyProgressionDefinition',
  'DestinyEventCardDefinition',
  'DestinyGuardianRankDefinition',
  'DestinyActivityModeDefinition',
  'DestinyActivityTypeDefinition',
] as const;

/**
 * When scanning for reverse references we visit these tables first: they are
 * the most likely to point at another definition and they are comparatively
 * small next to the full inventory item table.
 */
export const REVERSE_REF_PRIORITY_TABLES = [
  'DestinyPlugSetDefinition',
  'DestinyCollectibleDefinition',
  'DestinyPresentationNodeDefinition',
  'DestinyRecordDefinition',
  'DestinyVendorDefinition',
  'DestinyActivityDefinition',
  'DestinyInventoryItemDefinition',
] as const;

const INVENTORY_ITEM_TABLE = 'DestinyInventoryItemDefinition';
const INVENTORY_ITEM_LITE_TABLE = 'DestinyInventoryItemLiteDefinition';

/**
 * Virtual table that surfaces seasonal artifact perks. It is not a real Bungie
 * component; entries are drawn from InventoryItem definitions flagged as
 * artifact perks and presented as a dedicated table.
 */
export const ARTIFACT_PERKS_TABLE = 'ArtifactPerks';

const GROUP_TABLES: ReadonlyArray<readonly [TableStatus['group'], readonly string[]]> = [
  ['primary', [INVENTORY_ITEM_LITE_TABLE, INVENTORY_ITEM_TABLE]],
  [
    'gameplay',
    [
      'DestinySandboxPerkDefinition',
      'DestinyStatDefinition',
      'DestinyStatGroupDefinition',
      'DestinyItemCategoryDefinition',
      'DestinyDamageTypeDefinition',
      'DestinyClassDefinition',
      'DestinySocketCategoryDefinition',
      'DestinyBreakerTypeDefinition',
      'DestinyEnergyTypeDefinition',
      'DestinyInventoryBucketDefinition',
      'DestinyItemTierTypeDefinition',
      'DestinyTraitDefinition',
      'DestinyActivityDefinition',
      'DestinyActivityModifierDefinition',
      'DestinyActivityModeDefinition',
      'DestinyActivityTypeDefinition',
      'DestinyPlugSetDefinition',
      'DestinyObjectiveDefinition',
      'DestinySocketTypeDefinition',
      'DestinyArtifactDefinition',
      'DestinyEquipableItemSetDefinition',
      'DestinyVendorDefinition',
    ],
  ],
  [
    'world',
    [
      'DestinyDestinationDefinition',
      'DestinyPlaceDefinition',
      'DestinyLoreDefinition',
      'DestinyFactionDefinition',
      'DestinyActivityGraphDefinition',
      'DestinyActivityFamilyDefinition',
      'DestinyLocationDefinition',
    ],
  ],
  [
    'progression',
    [
      'DestinyCollectibleDefinition',
      'DestinyRecordDefinition',
      'DestinyPresentationNodeDefinition',
      'DestinySeasonDefinition',
      'DestinySeasonPassDefinition',
      'DestinyMilestoneDefinition',
      'DestinyProgressionDefinition',
      'DestinyMetricDefinition',
      'DestinyGuardianRankDefinition',
      'DestinyEventCardDefinition',
      'DestinyPowerCapDefinition',
    ],
  ],
  [
    'system',
    [
      'DestinyIconDefinition',
      'DestinyMaterialRequirementSetDefinition',
      'DestinyUnlockDefinition',
      'DestinyRewardSourceDefinition',
      'DestinyVendorGroupDefinition',
      'DestinyCommendationNodeDefinition',
      'DestinyLoadoutIconDefinition',
      'DestinyLoadoutColorDefinition',
      'DestinyLoadoutNameDefinition',
      'DestinyArtDyeChannelDefinition',
      'DestinyArtDyeDefinition',
      'DestinyEquipmentSlotDefinition',
      'DestinyTalentGridDefinition',
    ],
  ],
];

/** Convert PascalCase to space separated words without breaking acronyms. */
function pascalToWords(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip the Destiny prefix and Definition suffix from a table name. */
export function getShortTableName(table: string): string {
  const trimmed = table.trim();
  if (!trimmed) return trimmed;
  // Lite items are presented as regular inventory items throughout the app.
  if (trimmed === INVENTORY_ITEM_LITE_TABLE) return 'InventoryItem';
  if (trimmed === ARTIFACT_PERKS_TABLE) return 'Artifact Perks';

  let short = trimmed;
  if (short.startsWith('Destiny')) short = short.slice('Destiny'.length);
  if (short.endsWith('Definition')) short = short.slice(0, -'Definition'.length);
  if (short.endsWith('Lite')) short = short.slice(0, -'Lite'.length);
  return short || trimmed;
}

/** Human friendly table name, e.g. DestinyPresentationNodeDefinition -> Presentation Node. */
export function getFriendlyTableName(table: string): string {
  if (table === ARTIFACT_PERKS_TABLE) return 'Artifact Perks';
  return pascalToWords(getShortTableName(table));
}

/**
 * Canonical table name: the Lite inventory table is folded into the full one so
 * every consumer sees a single InventoryItem table.
 */
export function canonicalTableName(table: string): string {
  if (table === ARTIFACT_PERKS_TABLE) return ARTIFACT_PERKS_TABLE;
  return table === INVENTORY_ITEM_LITE_TABLE ? INVENTORY_ITEM_TABLE : table;
}

function buildTableMetadata(): Record<string, TableMetadata> {
  const metadata: Record<string, TableMetadata> = {};
  for (const [group, tables] of GROUP_TABLES) {
    for (const name of tables) {
      const shortName = getShortTableName(name);
      const entry: TableMetadata = {
        name,
        shortName,
        friendlyName: pascalToWords(shortName),
        group,
      };
      if (name === INVENTORY_ITEM_LITE_TABLE) entry.isLite = true;
      metadata[name] = entry;
    }
  }
  return metadata;
}

/** Metadata for every known manifest table, keyed by canonical Bungie name. */
export const TABLE_METADATA: Readonly<Record<string, TableMetadata>> = buildTableMetadata();

/** Resolve the display group for any table, falling back to heuristics. */
export function getTableGroup(table: string): TableStatus['group'] {
  const canonical = canonicalTableName(table);
  const metadata = TABLE_METADATA[canonical] ?? TABLE_METADATA[table];
  if (metadata) return metadata.group;

  const lower = canonical.toLowerCase();
  if (lower.includes('inventoryitem')) return 'primary';
  if (
    lower.includes('presentation') ||
    lower.includes('record') ||
    lower.includes('collectible') ||
    lower.includes('progress') ||
    lower.includes('season') ||
    lower.includes('milestone')
  ) {
    return 'progression';
  }
  if (lower.includes('activity') || lower.includes('objective') || lower.includes('socket')) {
    return 'gameplay';
  }
  if (lower.includes('destination') || lower.includes('place') || lower.includes('lore')) {
    return 'world';
  }
  return 'system';
}

function normalizeLookup(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Shortcuts accepted by the search box, the table filter and the hash resolver.
 * Targets are full Bungie table names.
 */
const TABLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  item: [INVENTORY_ITEM_TABLE],
  items: [INVENTORY_ITEM_TABLE],
  weapon: [INVENTORY_ITEM_TABLE],
  weapons: [INVENTORY_ITEM_TABLE],
  armor: [INVENTORY_ITEM_TABLE],
  armour: [INVENTORY_ITEM_TABLE],
  mod: [INVENTORY_ITEM_TABLE],
  mods: [INVENTORY_ITEM_TABLE],
  shader: [INVENTORY_ITEM_TABLE],
  shaders: [INVENTORY_ITEM_TABLE],
  perk: ['DestinySandboxPerkDefinition'],
  perks: ['DestinySandboxPerkDefinition'],
  sandboxperk: ['DestinySandboxPerkDefinition'],
  stat: ['DestinyStatDefinition'],
  stats: ['DestinyStatDefinition'],
  statgroup: ['DestinyStatGroupDefinition'],
  activity: ['DestinyActivityDefinition'],
  activities: ['DestinyActivityDefinition'],
  activitymode: ['DestinyActivityModeDefinition'],
  mode: ['DestinyActivityModeDefinition'],
  activitytype: ['DestinyActivityTypeDefinition'],
  activitymodifier: ['DestinyActivityModifierDefinition'],
  modifier: ['DestinyActivityModifierDefinition'],
  activitygraph: ['DestinyActivityGraphDefinition'],
  record: ['DestinyRecordDefinition'],
  records: ['DestinyRecordDefinition'],
  triumph: ['DestinyRecordDefinition'],
  triumphs: ['DestinyRecordDefinition'],
  collectible: ['DestinyCollectibleDefinition'],
  collectibles: ['DestinyCollectibleDefinition'],
  collection: ['DestinyCollectibleDefinition'],
  node: ['DestinyPresentationNodeDefinition'],
  nodes: ['DestinyPresentationNodeDefinition'],
  presentationnode: ['DestinyPresentationNodeDefinition'],
  plugset: ['DestinyPlugSetDefinition'],
  plugsets: ['DestinyPlugSetDefinition'],
  vendor: ['DestinyVendorDefinition'],
  vendors: ['DestinyVendorDefinition'],
  lore: ['DestinyLoreDefinition'],
  season: ['DestinySeasonDefinition'],
  seasons: ['DestinySeasonDefinition'],
  seasonpass: ['DestinySeasonPassDefinition'],
  artifact: ['DestinyArtifactDefinition'],
  artifacts: ['DestinyArtifactDefinition'],
  artifactperk: [ARTIFACT_PERKS_TABLE],
  artifactperks: [ARTIFACT_PERKS_TABLE],
  artifactmod: [ARTIFACT_PERKS_TABLE],
  artifactmods: [ARTIFACT_PERKS_TABLE],
  objective: ['DestinyObjectiveDefinition'],
  objectives: ['DestinyObjectiveDefinition'],
  bucket: ['DestinyInventoryBucketDefinition'],
  buckets: ['DestinyInventoryBucketDefinition'],
  socket: ['DestinySocketTypeDefinition'],
  sockets: ['DestinySocketTypeDefinition'],
  sockettype: ['DestinySocketTypeDefinition'],
  socketcat: ['DestinySocketCategoryDefinition'],
  socketcategory: ['DestinySocketCategoryDefinition'],
  damage: ['DestinyDamageTypeDefinition'],
  damagetype: ['DestinyDamageTypeDefinition'],
  element: ['DestinyDamageTypeDefinition'],
  category: ['DestinyItemCategoryDefinition'],
  categories: ['DestinyItemCategoryDefinition'],
  itemcategory: ['DestinyItemCategoryDefinition'],
  cat: ['DestinyItemCategoryDefinition'],
  trait: ['DestinyTraitDefinition'],
  traits: ['DestinyTraitDefinition'],
  milestone: ['DestinyMilestoneDefinition'],
  milestones: ['DestinyMilestoneDefinition'],
  icon: ['DestinyIconDefinition'],
  icons: ['DestinyIconDefinition'],
  faction: ['DestinyFactionDefinition'],
  factions: ['DestinyFactionDefinition'],
  destination: ['DestinyDestinationDefinition'],
  destinations: ['DestinyDestinationDefinition'],
  place: ['DestinyPlaceDefinition'],
  places: ['DestinyPlaceDefinition'],
  metric: ['DestinyMetricDefinition'],
  metrics: ['DestinyMetricDefinition'],
  progression: ['DestinyProgressionDefinition'],
  progressions: ['DestinyProgressionDefinition'],
  set: ['DestinyEquipableItemSetDefinition'],
  sets: ['DestinyEquipableItemSetDefinition'],
  itemset: ['DestinyEquipableItemSetDefinition'],
  breaker: ['DestinyBreakerTypeDefinition'],
  breakertype: ['DestinyBreakerTypeDefinition'],
  energy: ['DestinyEnergyTypeDefinition'],
  energytype: ['DestinyEnergyTypeDefinition'],
  class: ['DestinyClassDefinition'],
  classes: ['DestinyClassDefinition'],
  tier: ['DestinyItemTierTypeDefinition'],
  tiertype: ['DestinyItemTierTypeDefinition'],
  rank: ['DestinyGuardianRankDefinition'],
  guardianrank: ['DestinyGuardianRankDefinition'],
  event: ['DestinyEventCardDefinition'],
  eventcard: ['DestinyEventCardDefinition'],
  powercap: ['DestinyPowerCapDefinition'],
  material: ['DestinyMaterialRequirementSetDefinition'],
  unlock: ['DestinyUnlockDefinition'],
  reward: ['DestinyRewardSourceDefinition'],
  rewardsource: ['DestinyRewardSourceDefinition'],
  plug: [INVENTORY_ITEM_TABLE],
  plugs: [INVENTORY_ITEM_TABLE],
  emblem: [INVENTORY_ITEM_TABLE],
  emblems: [INVENTORY_ITEM_TABLE],
  ghost: [INVENTORY_ITEM_TABLE],
  ghosts: [INVENTORY_ITEM_TABLE],
  ship: [INVENTORY_ITEM_TABLE],
  ships: [INVENTORY_ITEM_TABLE],
  sparrow: [INVENTORY_ITEM_TABLE],
  sparrows: [INVENTORY_ITEM_TABLE],
  vehicle: [INVENTORY_ITEM_TABLE],
  vehicles: [INVENTORY_ITEM_TABLE],
  subclass: [INVENTORY_ITEM_TABLE],
  subclasses: [INVENTORY_ITEM_TABLE],
  bounty: [INVENTORY_ITEM_TABLE],
  bounties: [INVENTORY_ITEM_TABLE],
  quest: [INVENTORY_ITEM_TABLE],
  quests: [INVENTORY_ITEM_TABLE],
  consumable: [INVENTORY_ITEM_TABLE],
  consumables: [INVENTORY_ITEM_TABLE],
  engram: [INVENTORY_ITEM_TABLE],
  engrams: [INVENTORY_ITEM_TABLE],
};

function availableInventoryVariant(availableTables: readonly string[]): string | undefined {
  return (
    availableTables.find((name) => name === INVENTORY_ITEM_TABLE) ??
    availableTables.find((name) => name === INVENTORY_ITEM_LITE_TABLE)
  );
}

function findAvailableMatch(target: string, availableTables: readonly string[]): string | undefined {
  const exact = availableTables.find((name) => name === target);
  if (exact) return exact;

  if (target === INVENTORY_ITEM_TABLE || target === INVENTORY_ITEM_LITE_TABLE) {
    return availableInventoryVariant(availableTables);
  }

  const normalizedTarget = normalizeLookup(target);
  return availableTables.find((name) => normalizeLookup(name) === normalizedTarget);
}

/**
 * Resolve a user supplied table shortcut (or partial name) to a table that is
 * actually present in the manifest. Returns null when nothing plausible exists.
 */
export function resolveTableAlias(alias: string, availableTables: string[]): string | null {
  const raw = alias.trim();
  if (!raw) return null;
  const normalized = normalizeLookup(raw);

  // Exact full table name first.
  const exact = availableTables.find((table) => normalizeLookup(table) === normalized);
  if (exact) return exact;

  // Exact short/friendly name (e.g. "sandboxperk", "presentationnode").
  const shortExact = availableTables.find((table) => {
    const short = getShortTableName(table);
    return normalizeLookup(short) === normalized || normalizeLookup(pascalToWords(short)) === normalized;
  });
  if (shortExact) return shortExact;

  // Explicit shortcuts.
  const targets = TABLE_ALIASES[raw.toLowerCase()] ?? TABLE_ALIASES[normalized];
  if (targets) {
    for (const target of targets) {
      const match = findAvailableMatch(target, availableTables);
      if (match) return match;
    }
  }

  // Partial case-insensitive match against full and short names.
  const prefix = availableTables.find((table) => {
    const short = getShortTableName(table);
    return normalizeLookup(table).startsWith(normalized) || normalizeLookup(short).startsWith(normalized);
  });
  if (prefix) return prefix;

  if (normalized.length >= 3) {
    const contained = availableTables.find((table) => {
      const short = getShortTableName(table);
      return normalizeLookup(table).includes(normalized) || normalizeLookup(short).includes(normalized);
    });
    if (contained) return contained;
  }

  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
  return numbers.length > 0 ? numbers : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length > 0 ? strings : undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return undefined;
}

/**
 * Build a compact search index entry from a raw manifest definition.
 *
 * The Lite inventory table does not repeat `hash`/`index` inside the object,
 * so the hash always comes from the key of the definition map.
 */
export function extractTableEntrySummary(
  table: string,
  hashKey: string,
  raw: Record<string, unknown>,
): SearchIndexEntry {
  const canonicalTable = canonicalTableName(table);
  const numericHash = Number(hashKey);
  const hash = Number.isFinite(numericHash) ? numericHash >>> 0 : 0;

  const displayProperties = asRecord(raw.displayProperties);
  const name =
    firstString(
      displayProperties?.name,
      raw.statName,
      raw.progressDescription,
      raw.title,
      raw.traitName,
      raw.displayName,
      raw.tierName,
      raw.categoryName,
      raw.name,
    ) ?? (asNumber(raw.questlineItemHash) !== undefined ? 'Questline' : '');

  const friendlyName = getFriendlyTableName(canonicalTable);
  const subtitle =
    firstString(
      raw.itemTypeAndTierDisplayName,
      raw.itemTypeDisplayName,
      displayProperties?.subtitle,
      raw.subtitle,
      raw.traitName,
    ) ?? friendlyName;

  const descriptionParts = [
    displayProperties?.description,
    raw.flavorText,
    displayProperties?.flavorText,
    raw.displaySource,
    raw.sourceString,
    raw.description,
    raw.tooltip,
  ]
    .map((value) => asString(value))
    .filter((value): value is string => value !== undefined);

  const descLower = truncate(normalizeText(descriptionParts.join(' ')), 600);
  const nameLower = normalizeText(name);
  const subtitleLower = normalizeText(subtitle);

  const icon = firstString(displayProperties?.icon, raw.icon);
  const iconWatermark = firstString(
    displayProperties?.iconWatermark,
    raw.iconWatermark,
    raw.iconWatermarkShelved,
  );
  const index = asNumber(raw.index);

  const seasonHash = asNumber(raw.seasonHash);
  const seasonNumber = asNumber(raw.seasonNumber);
  const sourceLower = normalizeText(firstString(raw.displaySource, raw.sourceString) ?? '');
  const traitIds = asStringArray(raw.traitIds)?.map((trait) => trait.toLowerCase());

  const entry: SearchIndexEntry = {
    hash,
    table: canonicalTable,
    name,
    nameLower,
    subtitle,
    subtitleLower,
    descLower,
  };

  if (icon) entry.icon = icon;
  if (iconWatermark) entry.iconWatermark = iconWatermark;
  if (index !== undefined) entry.index = index;
  if (seasonHash !== undefined) entry.seasonHash = seasonHash >>> 0;
  if (seasonNumber !== undefined) entry.seasonNumber = seasonNumber;
  if (sourceLower) entry.sourceLower = truncate(sourceLower, 300);
  if (traitIds) entry.traitIds = traitIds;

  if (canonicalTable === INVENTORY_ITEM_TABLE) {
    const inventory = asRecord(raw.inventory);
    const plug = asRecord(raw.plug);

    const tierType = asNumber(inventory?.tierType) ?? asNumber(raw.tierType);
    const itemType = asNumber(raw.itemType);
    const itemSubType = asNumber(raw.itemSubType);
    const classType = asNumber(raw.classType);
    const damageType = asNumber(raw.defaultDamageType) ?? asNumber(raw.damageType);
    const itemCategoryHashes = asNumberArray(raw.itemCategoryHashes);
    const plugCategoryIdentifier =
      firstString(plug?.plugCategoryIdentifier, raw.plugCategoryIdentifier) ?? undefined;

    if (tierType !== undefined) entry.tierType = tierType;
    if (itemType !== undefined) entry.itemType = itemType;
    if (itemSubType !== undefined) entry.itemSubType = itemSubType;
    if (classType !== undefined) entry.classType = classType;
    if (damageType !== undefined) entry.damageType = damageType;
    if (itemCategoryHashes) entry.itemCategoryHashes = itemCategoryHashes;
    if (plugCategoryIdentifier) entry.plugCategoryIdentifier = plugCategoryIdentifier;

    const equippingBlock = asRecord(raw.equippingBlock);
    const ammoType = asNumber(equippingBlock?.ammoType) ?? asNumber(raw.ammoType);
    const bucketHash = asNumber(inventory?.bucketTypeHash) ?? asNumber(raw.bucketTypeHash);
    const collectibleHash = asNumber(raw.collectibleHash);
    if (ammoType !== undefined) entry.ammoType = ammoType;
    if (bucketHash !== undefined) entry.bucketHash = bucketHash >>> 0;
    if (collectibleHash !== undefined) entry.collectibleHash = collectibleHash >>> 0;

    const redacted = asBoolean(raw.redacted) === true || asBoolean(raw.isRedacted) === true;
    entry.isRedacted = redacted;

    const tierTypeName = normalizeText(asString(inventory?.tierTypeName) ?? '');
    const typeDisplay = normalizeText(asString(raw.itemTypeDisplayName) ?? '');
    const tierAndTypeDisplay = normalizeText(asString(raw.itemTypeAndTierDisplayName) ?? '');
    const plugCategoryLower = normalizeText(plugCategoryIdentifier ?? '');
    const isAdept =
      asBoolean(raw.isAdept) === true ||
      tierTypeName.includes('adept') ||
      typeDisplay.includes('adept') ||
      nameLower.includes('(adept)') ||
      nameLower.includes('(timelost)') ||
      nameLower.includes('(harrowed)');
    entry.isAdept = isAdept;

    const isArtifactPerk = typeDisplay === 'artifact perk' || plugCategoryLower === 'artifact_perks';
    entry.isArtifactPerk = isArtifactPerk;

    const isHolofoil =
      asBoolean(raw.isHolofoil) === true ||
      typeDisplay.includes('holofoil') ||
      nameLower.includes('holofoil');
    entry.isHolofoil = isHolofoil;

    const hasEnhancedTrait = traitIds?.some((trait) => trait.includes('enhanced')) === true;
    const isEnhanced =
      typeDisplay.includes('enhanced') ||
      tierAndTypeDisplay.includes('enhanced') ||
      plugCategoryLower.includes('enhanced') ||
      nameLower.endsWith('(enhanced)') ||
      nameLower.startsWith('enhanced ') ||
      hasEnhancedTrait;
    entry.isEnhanced = isEnhanced;

    const isFeatured = asBoolean(raw.isFeatured) === true || asBoolean(raw.featured) === true;
    entry.isFeatured = isFeatured;

    const isDummy =
      asBoolean(raw.isDummy) === true ||
      itemType === 20 ||
      nameLower.startsWith('dummy') ||
      nameLower.includes('[dummy]');
    entry.isDummy = isDummy;

    const recipeItemHash = asNumber(inventory?.recipeItemHash);
    const hasCraftingTrait =
      traitIds?.some(
        (trait) =>
          trait.includes('crafted') ||
          trait.includes('deepsight') ||
          trait.includes('deep sight') ||
          trait.includes('shaped'),
      ) === true;
    const isCraftable =
      (recipeItemHash !== undefined && recipeItemHash > 0) ||
      itemType === 30 ||
      hasCraftingTrait;
    entry.isCraftable = isCraftable;

    const isCatalyst =
      nameLower.includes('catalyst') ||
      typeDisplay.includes('catalyst') ||
      tierAndTypeDisplay.includes('catalyst') ||
      plugCategoryLower.includes('catalyst');
    entry.isCatalyst = isCatalyst;

    const isOrnament =
      typeDisplay.includes('ornament') ||
      tierAndTypeDisplay.includes('ornament') ||
      plugCategoryLower.includes('ornament');
    entry.isOrnament = isOrnament;

    const loreHash = asNumber(raw.loreHash);
    entry.hasLore = loreHash !== undefined && loreHash > 0;
    entry.hasScreenshot = asString(raw.screenshot) !== undefined;
    entry.hasFlavor =
      asString(raw.flavorText) !== undefined ||
      asString(displayProperties?.flavorText) !== undefined;
    entry.hasCollectible = (collectibleHash ?? 0) > 0;
  }

  return entry;
}
