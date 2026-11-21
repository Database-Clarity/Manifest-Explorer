export const BUNGIE_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'es-mx', label: 'Español (México)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'pt-br', label: 'Português (Brasil)' },
  { code: 'ru', label: 'Русский' },
  { code: 'pl', label: 'Polski' },
  { code: 'ko', label: '한국어' },
  { code: 'zh-cht', label: '繁體中文' },
  { code: 'zh-chs', label: '简体中文' },
] as const;

export type BungieLocale = (typeof BUNGIE_LOCALES)[number]['code'];

export type SortMode = 'relevance' | 'name-asc' | 'name-desc' | 'hash-asc' | 'hash-desc' | 'index-desc';

export type InspectorTab = 'pretty' | 'overview' | 'variants' | 'references' | 'raw' | 'diff';

export type ViewMode = 'list' | 'grid';

export interface SearchIndexEntry {
  /** Unsigned 32-bit hash */
  hash: number;
  /** Full Bungie table name e.g. DestinyInventoryItemDefinition */
  table: string;
  /** Display name (may be empty for unnamed definitions) */
  name: string;
  /** Lowercased name for fast matching */
  nameLower: string;
  /** Short subtitle: itemTypeAndTierDisplayName, itemTypeDisplayName, or table friendly name */
  subtitle: string;
  /** Lowercased subtitle */
  subtitleLower: string;
  /** Lowercased description + flavorText snippet for secondary search */
  descLower: string;
  /** Relative Bungie icon path (/common/...) */
  icon?: string;
  /** Relative Bungie icon watermark path */
  iconWatermark?: string;
  /** Bungie index property if present */
  index?: number;
  /** Optional item metadata (only for InventoryItem) */
  tierType?: number;
  itemType?: number;
  itemSubType?: number;
  classType?: number;
  damageType?: number;
  itemCategoryHashes?: number[];
  /** DestinyAmmunitionType: 1 Primary, 2 Special, 3 Heavy */
  ammoType?: number;
  /** Inventory bucket type hash (equipment slot) */
  bucketHash?: number;
  /** Associated Destiny season/episode number (1-based) */
  seasonNumber?: number;
  /** DestinySeasonDefinition hash */
  seasonHash?: number;
  /** Collectible definition hash when present */
  collectibleHash?: number;
  isRedacted?: boolean;
  isAdept?: boolean;
  isEnhanced?: boolean;
  isHolofoil?: boolean;
  isFeatured?: boolean;
  isDummy?: boolean;
  isArtifact?: boolean;
  isCraftable?: boolean;
  isCatalyst?: boolean;
  isOrnament?: boolean;
  hasLore?: boolean;
  hasScreenshot?: boolean;
  hasFlavor?: boolean;
  hasCollectible?: boolean;
  /** Normalized displaySource / sourceString snippet for `source:` search */
  sourceLower?: string;
  /** Lowercased trait id strings for `trait:` search */
  traitIds?: string[];
  plugCategoryIdentifier?: string;
}

export interface DeepMatchSnippet {
  path: string;
  preview: string;
}

export interface SearchResultItem {
  hash: number;
  table: string;
  name: string;
  subtitle: string;
  icon?: string;
  iconWatermark?: string;
  tierType?: number;
  damageType?: number;
  classType?: number;
  isRedacted?: boolean;
  isEnhanced?: boolean;
  index?: number;
  deepMatch?: DeepMatchSnippet;
}

export interface SearchFilters {
  /** Single selected table or 'all' */
  table: string;
  tierTypes: number[];
  damageTypes: number[];
  classTypes: number[];
  itemTypes: number[];
  itemCategoryHashes: number[];
  includeUnnamed: boolean;
  onlyRedacted: boolean;
}

export interface SearchResponse {
  items: SearchResultItem[];
  totalMatches: number;
  durationMs: number;
}

export interface TableStatus {
  name: string;
  shortName: string;
  group: 'primary' | 'gameplay' | 'world' | 'progression' | 'system';
  count: number;
  loaded: boolean;
  loading: boolean;
  indexed: boolean;
  hasFullData: boolean;
}

export interface ManifestStatus {
  phase: 'idle' | 'fetching-index' | 'loading-core' | 'indexing-secondary' | 'ready' | 'error';
  version: string;
  versionSignature: string;
  locale: BungieLocale;
  fromCache: boolean;
  loadedTableCount: number;
  totalTableCount: number;
  indexedEntryCount: number;
  currentTable?: string;
  error?: string;
  lastCheckedAt?: number;
}

export interface DefinitionRef {
  table: string;
  hash: number;
  /** Optional display name known at click time so tabs & history never flash Table:Hash. */
  label?: string;
  /** Optional icon path known at click time. */
  icon?: string;
}

export interface ResolvedSummaryEntry {
  name: string;
  icon?: string;
  /** True when the same unsigned hash exists in more than one manifest table/category. */
  hasCoTables?: boolean;
}

export interface ResolvedHashSummary {
  table: string;
  hash: number;
  name: string;
  subtitle: string;
  icon?: string;
  tierType?: number;
}

export interface DefinitionDetailPayload {
  table: string;
  hash: number;
  data: Record<string, unknown>;
  /** True if InventoryItem came from Lite fallback while full table is still loading */
  isLite?: boolean;
  /** Other tables that contain the exact same hash */
  coTables: string[];
  /** Quick lookup map for all hashes referenced inside this definition (`table:hash` or `hash`) */
  resolvedRefs: Record<string, ResolvedHashSummary>;
  /** Resolved overview data for InventoryItem / PlugSet / Record / Collectible / etc. */
  overview?: DefinitionOverview;
}

export interface OverviewSocketPlug {
  hash: number;
  name: string;
  itemTypeDisplayName: string;
  description: string;
  icon?: string;
  tierType?: number;
  isEnhanced?: boolean;
  isDefault?: boolean;
  isCurated?: boolean;
  currentlyCanRoll?: boolean;
}

export interface OverviewSocket {
  socketIndex: number;
  socketTypeName: string;
  singleInitialPlug?: OverviewSocketPlug;
  plugs: OverviewSocketPlug[];
  plugSetHash?: number;
  isRandomized?: boolean;
}

export interface OverviewSocketCategory {
  categoryHash: number;
  name: string;
  description?: string;
  sockets: OverviewSocket[];
}

export interface OverviewStat {
  statHash: number;
  name: string;
  description?: string;
  value: number;
  maximumValue: number;
  isBar: boolean;
}

export interface OverviewPerk {
  perkHash: number;
  name: string;
  description: string;
  icon?: string;
}

export interface OverviewLore {
  loreHash: number;
  name: string;
  subtitle: string;
  description: string;
}

export interface OverviewLinkedEntity {
  table: string;
  hash: number;
  name: string;
  subtitle: string;
  icon?: string;
  relation: string;
}

export interface DefinitionOverview {
  flavorText?: string;
  displaySource?: string;
  screenshot?: string;
  damageType?: { hash: number; name: string; enumValue: number; icon?: string };
  tierName?: string;
  className?: string;
  ammoType?: string;
  categories?: { hash: number; name: string }[];
  stats?: OverviewStat[];
  socketCategories?: OverviewSocketCategory[];
  perks?: OverviewPerk[];
  lore?: OverviewLore;
  collectible?: { hash: number; sourceString: string; name: string };
  linkedEntities?: OverviewLinkedEntity[];
}

export interface ReverseReference {
  sourceTable: string;
  sourceHash: number;
  sourceName: string;
  sourceSubtitle: string;
  sourceIcon?: string;
  paths: string[];
}

export interface ReverseReferenceResponse {
  references: ReverseReference[];
  scannedTables: string[];
  unloadedPriorityTables: string[];
  durationMs: number;
}

export interface VariantItem {
  hash: number;
  table: string;
  name: string;
  subtitle: string;
  icon?: string;
  iconWatermark?: string;
  tierType?: number;
  damageType?: number;
  isAdept?: boolean;
  isEnhanced?: boolean;
  isHolofoil?: boolean;
  isRedacted?: boolean;
  index?: number;
}

export interface ClarityDescriptionEntry {
  hash: number;
  name?: string;
  type?: string;
  lastUpload?: number;
  uploadedBy?: string;
  lines: string[];
}

export interface FilterOption {
  value: number;
  label: string;
  count?: number;
}

export interface FilterCatalog {
  categories: FilterOption[];
  /** Season/episode filter options (value = seasonNumber), newest first. */
  seasons?: FilterOption[];
}

export type ImageScalingMode = 'sharp' | 'integer' | 'smooth';
