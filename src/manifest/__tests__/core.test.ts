import { describe, expect, it } from 'vitest';
import type { SearchFilters, SearchIndexEntry } from '../../types/manifest';
import { computeJsonDiff } from '../diff';
import {
  CLASS_FILTER_OPTIONS,
  DAMAGE_FILTER_OPTIONS,
  DamageType,
  DestinyItemSubType,
  DestinyItemType,
  SocketPlugSources,
  TIER_FILTER_OPTIONS,
  annotateEnumField,
} from '../enums';
import {
  FIELD_TO_TARGET_TABLE,
  bungieAssetUrl,
  extractAllHashesFromQuery,
  getTargetTablesForField,
  getTargetTablesForObjectKey,
  isBungieImagePath,
  parseHashInput,
  toSignedHash,
  toUnsignedHash,
} from '../hash';
import { parseSearchQuery, scoreAndFilterEntries, type SearchContext } from '../query';
import { SEASON_ALIASES, getD2aiMappings } from '../d2ai';
import {
  ARTIFACT_PERKS_TABLE,
  CORE_BOOT_TABLES,
  extractTableEntrySummary,
  getFriendlyTableName,
  getShortTableName,
  getTableGroup,
  resolveTableAlias,
} from '../tables';
import { SEARCH_INDEX_SCHEMA_VERSION } from '../idb';

const ITEM_TABLE = 'DestinyInventoryItemDefinition';
const LITE_TABLE = 'DestinyInventoryItemLiteDefinition';

function makeEntry(overrides: Partial<SearchIndexEntry> & { hash: number }): SearchIndexEntry {
  const name = overrides.name ?? '';
  const subtitle = overrides.subtitle ?? 'Weapon';
  const base: SearchIndexEntry = {
    hash: overrides.hash,
    table: overrides.table ?? ITEM_TABLE,
    name,
    nameLower: overrides.nameLower ?? name.toLowerCase(),
    subtitle,
    subtitleLower: overrides.subtitleLower ?? subtitle.toLowerCase(),
    descLower: overrides.descLower ?? '',
  };
  return { ...base, ...overrides };
}

function makeFilters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
    table: 'all',
    tierTypes: [],
    damageTypes: [],
    classTypes: [],
    itemTypes: [],
    itemCategoryHashes: [],
    includeUnnamed: true,
    onlyRedacted: false,
    ...overrides,
  };
}

function rank(
  query: string,
  entries: SearchIndexEntry[],
  options: {
    filters?: Partial<SearchFilters>;
    sort?: 'relevance' | 'name-asc' | 'name-desc' | 'hash-asc' | 'hash-desc' | 'index-desc';
    categories?: Map<number, string>;
    maxResults?: number;
    context?: SearchContext;
  } = {},
) {
  return scoreAndFilterEntries(
    entries,
    parseSearchQuery(query, [ITEM_TABLE, 'DestinySandboxPerkDefinition', 'DestinyRecordDefinition']),
    makeFilters(options.filters),
    options.sort ?? 'relevance',
    options.categories ?? new Map(),
    options.maxResults,
    options.context,
  );
}

describe('hash utilities', () => {
  it('converts signed and unsigned hashes', () => {
    expect(toUnsignedHash(-1)).toBe(4294967295);
    expect(toUnsignedHash(1363886209)).toBe(1363886209);
    expect(toSignedHash(4294967295)).toBe(-1);
    expect(toSignedHash(1363886209)).toBe(1363886209);
  });

  it('parses decimal, signed, negative-mirror and hex input', () => {
    expect(parseHashInput('1363886209')).toBe(1363886209);
    expect(parseHashInput(' 1363886209 ')).toBe(1363886209);
    expect(parseHashInput('-2931081087')).toBe(1363886209);
    expect(parseHashInput('0x514c2131')).toBe(0x514c2131);
    expect(parseHashInput('#1363886209')).toBe(1363886209);
    expect(parseHashInput('hash:1363886209')).toBe(1363886209);
  });

  it('rejects invalid, unsafe and out-of-range input', () => {
    expect(parseHashInput('')).toBeNull();
    expect(parseHashInput('abc')).toBeNull();
    expect(parseHashInput('12.5')).toBeNull();
    expect(parseHashInput('0xGG')).toBeNull();
    expect(parseHashInput('4294967296')).toBeNull();
    expect(parseHashInput('-4294967296')).toBeNull();
    expect(parseHashInput('0x100000000')).toBeNull();
  });

  it('extracts multiple pasted hashes and de-duplicates them', () => {
    const hashes = extractAllHashesFromQuery('1363886209, 2923251173 -1368098261\n1363886209');
    expect(hashes).toEqual([
      1363886209,
      2923251173,
      toUnsignedHash(-1368098261),
    ]);
    expect(extractAllHashesFromQuery('')).toEqual([]);
    expect(extractAllHashesFromQuery('hello world')).toEqual([]);
    expect(extractAllHashesFromQuery('123, 456')).toEqual([123, 456]);
  });

  it('maps manifest hash fields to target tables', () => {
    expect(getTargetTablesForField('collectibleHash')).toEqual(['DestinyCollectibleDefinition']);
    expect(getTargetTablesForField('loreHash')).toEqual(['DestinyLoreDefinition']);
    expect(getTargetTablesForField('damageTypeHashes')).toEqual(['DestinyDamageTypeDefinition']);
    expect(getTargetTablesForField('bucketTypeHash')).toEqual(['DestinyInventoryBucketDefinition']);
    expect(getTargetTablesForField('perkHash')).toEqual([
      'DestinySandboxPerkDefinition',
      'DestinyInventoryItemDefinition',
    ]);
    expect(getTargetTablesForField('setItems')).toEqual([ITEM_TABLE]);
    expect(getTargetTablesForField('activityModifierHash')).toEqual([
      'DestinyActivityModifierDefinition',
    ]);
    expect(getTargetTablesForField('seasonPassHash')).toEqual(['DestinySeasonPassDefinition']);
    expect(getTargetTablesForField('loadoutIconHash')).toEqual(['DestinyLoadoutIconDefinition']);
    expect(getTargetTablesForField('unknownField')).toEqual([]);
    expect(FIELD_TO_TARGET_TABLE.collectibleHash).toContain('DestinyCollectibleDefinition');
  });

  it('uses parent context for generic hash fields', () => {
    expect(getTargetTablesForField('hash', 'collectible')).toEqual(['DestinyCollectibleDefinition']);
    expect(getTargetTablesForField('hash', 'plugSet')).toEqual(['DestinyPlugSetDefinition']);
    expect(getTargetTablesForField('hash', 'unknownContext')).toEqual([]);
  });

  it('maps hash-keyed collection keys to target tables', () => {
    expect(getTargetTablesForObjectKey('stats')).toEqual(['DestinyStatDefinition']);
    expect(getTargetTablesForObjectKey('stat')).toEqual(['DestinyStatDefinition']);
    expect(getTargetTablesForObjectKey('objectives')).toEqual(['DestinyObjectiveDefinition']);
    expect(getTargetTablesForObjectKey('perks')).toEqual([
      'DestinySandboxPerkDefinition',
      'DestinyInventoryItemDefinition',
    ]);
    expect(getTargetTablesForObjectKey('items')).toEqual(['DestinyInventoryItemDefinition']);
    expect(getTargetTablesForObjectKey('nodes')).toEqual(['DestinyPresentationNodeDefinition']);
    expect(getTargetTablesForObjectKey('progressions')).toEqual(['DestinyProgressionDefinition']);
    expect(getTargetTablesForObjectKey('vendors')).toEqual(['DestinyVendorDefinition']);
    expect(getTargetTablesForObjectKey('activities')).toEqual(['DestinyActivityDefinition']);
    expect(getTargetTablesForObjectKey('records')).toEqual(['DestinyRecordDefinition']);
    expect(getTargetTablesForObjectKey('collectibles')).toEqual(['DestinyCollectibleDefinition']);
    expect(getTargetTablesForObjectKey(undefined)).toEqual([]);
    expect(getTargetTablesForObjectKey('unknown')).toEqual([]);
  });

  it('detects and resolves Bungie asset paths', () => {
    expect(isBungieImagePath('/common/destiny2_content/icons/a.png')).toBe(true);
    expect(isBungieImagePath('/img/theme/bungienet/icon.PNG')).toBe(true);
    expect(isBungieImagePath('/common/destiny2_content/icons/a.txt')).toBe(false);
    expect(isBungieImagePath('/img/theme/icon')).toBe(false);
    expect(isBungieImagePath(42)).toBe(false);
    expect(bungieAssetUrl('/common/destiny2_content/icons/a.png')).toBe(
      'https://www.bungie.net/common/destiny2_content/icons/a.png',
    );
    expect(bungieAssetUrl('img/a.png')).toBe('https://www.bungie.net/img/a.png');
  });
});

describe('enum annotations', () => {
  it('annotates standard enum fields', () => {
    expect(annotateEnumField('itemType', 3)).toEqual({
      enumName: 'DestinyItemType',
      label: 'Weapon',
    });
    expect(annotateEnumField('itemSubType', 6)?.label).toBe('AutoRifle');
    expect(annotateEnumField('tierType', 6)?.label).toBe('Exotic');
    expect(annotateEnumField('classType', 0)?.label).toBe('Titan');
    expect(annotateEnumField('damageType', 3)?.label).toBe('Solar');
    expect(annotateEnumField('ammoType', 2)?.label).toBe('Special');
    expect(annotateEnumField('breakerType', 1)?.label).toBe('ShieldPiercing');
  });

  it('annotates bitmask fields with combined labels', () => {
    const annotation = annotateEnumField('plugSources', 10);
    expect(annotation).toEqual({
      enumName: 'SocketPlugSources',
      label: 'CharacterPlugSet | ReusablePlugItems',
      isBitmask: true,
    });
    expect(annotateEnumField('socketPlugSources', 0)?.label).toBe('None');
    expect(annotateEnumField('plugUiStyles', 1)).toEqual({
      enumName: 'PlugUiStyles',
      label: 'Masterwork',
      isBitmask: true,
    });
    expect(annotateEnumField('equippingBlockAttributes', 1)?.label).toBe('EquipOnAcquire');
    expect(annotateEnumField('plugSources', 16)).toBeNull();
    expect(SocketPlugSources[8]).toBe('CharacterPlugSet');
    expect(DestinyItemSubType[20]).toBe('Shader');
  });

  it('resolves contextual fields', () => {
    expect(annotateEnumField('uiStyle', 1, 'objective')?.label).toBe('Highlighted');
    expect(annotateEnumField('uiStyle', 1, 'plug')?.label).toBe('Masterwork');
    expect(annotateEnumField('uiStyle', 1)).toBeNull();
    expect(annotateEnumField('type', 1, 'presentationNode')?.label).toBe('Category');
    expect(annotateEnumField('type', 63, 'activityMode')?.label).toBe('Gambit');
  });

  it('returns null for hashes, unknown fields and unknown values', () => {
    expect(annotateEnumField('itemTypeHash', 3)).toBeNull();
    expect(annotateEnumField('hash', 3)).toBeNull();
    expect(annotateEnumField('mysteryField', 3)).toBeNull();
    expect(annotateEnumField('itemType', 999)).toBeNull();
    expect(annotateEnumField('tierType', 1.5)).toBeNull();
  });

  it('ships filter option catalogs', () => {
    expect(TIER_FILTER_OPTIONS.find((option) => option.label === 'Exotic')?.value).toBe(6);
    expect(DAMAGE_FILTER_OPTIONS.find((option) => option.label === 'Solar')?.value).toBe(3);
    expect(CLASS_FILTER_OPTIONS.find((option) => option.label === 'Titan')?.value).toBe(0);
  });

  it('ships recent item type, sub-type and damage type values', () => {
    expect(DestinyItemSubType[33]).toBe('Glaive');
    expect(DestinyItemType[30]).toBe('Pattern');
    expect(DamageType[7]).toBe('Strand');
    expect(DamageType[6]).toBe('Stasis');
  });

  it('annotates newly added Destiny 2 enums', () => {
    expect(annotateEnumField('refundPolicy', 1)?.label).toBe('DeletesItem');
    expect(annotateEnumField('raceType', 2)?.label).toBe('Exo');
    expect(annotateEnumField('genderType', 1)?.label).toBe('Female');
    expect(annotateEnumField('membershipType', 1)?.label).toBe('TigerXbox');
    expect(annotateEnumField('unlockStatus', 2)?.label).toBe('Unlocked');
    expect(annotateEnumField('itemSortType', 1)?.label).toBe('Timestamp');
    expect(annotateEnumField('navPointType', 1)?.label).toBe('Primary');
    expect(annotateEnumField('rewardSourceCategory', 2)?.label).toBe('Vendor');
  });

  it('annotates bitmask enums for records, collectibles, equips and talent nodes', () => {
    expect(annotateEnumField('recordState', 1 | 64)).toEqual({
      enumName: 'DestinyRecordState',
      label: 'CanEquipTitle | RecordRedeemed',
      isBitmask: true,
    });
    expect(annotateEnumField('collectibleState', 1)?.label).toBe('NotAcquired');
    expect(annotateEnumField('equipFailureReason', 1)?.label).toBe('ItemUnequippable');
    expect(annotateEnumField('joinClosedReasons', 1)?.label).toBe('InMatchmaking');
    expect(annotateEnumField('weaponPerformances', 1)?.label).toBe('RateOfFire');
    expect(annotateEnumField('impactEffects', 1)?.label).toBe('ArmorPiercing');
    expect(annotateEnumField('guardianAttributes', 1)?.label).toBe('Stats');
    expect(annotateEnumField('lightAbilities', 1)?.label).toBe('Grenades');
    expect(annotateEnumField('talentNodeStepDamageTypes', 2)?.label).toBe('Arc');
  });

  it('resolves contextual state, category and mode fields', () => {
    expect(annotateEnumField('state', 1, 'record')?.label).toBe('RecordRedeemed');
    expect(annotateEnumField('state', 1, 'collectible')?.label).toBe('NotAcquired');
    expect(annotateEnumField('state', 1, 'graphNode')?.label).toBe('Visible');
    expect(annotateEnumField('category', 1, 'bucket')?.label).toBe('Item');
    expect(annotateEnumField('category', 1, 'rewardSource')?.label).toBe('Activity');
    expect(annotateEnumField('mode', 63, 'activityMode')?.label).toBe('Gambit');
  });
});

describe('table metadata and summaries', () => {
  const tables = [
    ITEM_TABLE,
    'DestinySandboxPerkDefinition',
    'DestinyRecordDefinition',
    'DestinySocketTypeDefinition',
    'DestinySocketCategoryDefinition',
    'DestinyPresentationNodeDefinition',
    'DestinyCollectibleDefinition',
  ];

  it('strips Destiny/Definition and normalizes the Lite table', () => {
    expect(getShortTableName(ITEM_TABLE)).toBe('InventoryItem');
    expect(getShortTableName(LITE_TABLE)).toBe('InventoryItem');
    expect(getShortTableName('DestinySandboxPerkDefinition')).toBe('SandboxPerk');
    expect(getFriendlyTableName(ITEM_TABLE)).toBe('Inventory Item');
    expect(getFriendlyTableName('DestinyPresentationNodeDefinition')).toBe('Presentation Node');
    expect(CORE_BOOT_TABLES).toContain(LITE_TABLE);
  });

  it('assigns display groups', () => {
    expect(getTableGroup(LITE_TABLE)).toBe('primary');
    expect(getTableGroup(ITEM_TABLE)).toBe('primary');
    expect(getTableGroup('DestinySandboxPerkDefinition')).toBe('gameplay');
    expect(getTableGroup('DestinyRecordDefinition')).toBe('progression');
    expect(getTableGroup('DestinyDestinationDefinition')).toBe('world');
    expect(getTableGroup('DestinyIconDefinition')).toBe('system');
  });

  it('resolves shortcuts, plurals and partial names', () => {
    expect(resolveTableAlias('item', tables)).toBe(ITEM_TABLE);
    expect(resolveTableAlias('items', tables)).toBe(ITEM_TABLE);
    expect(resolveTableAlias('perk', tables)).toBe('DestinySandboxPerkDefinition');
    expect(resolveTableAlias('triumph', tables)).toBe('DestinyRecordDefinition');
    expect(resolveTableAlias('socketcat', tables)).toBe('DestinySocketCategoryDefinition');
    expect(resolveTableAlias('sockettype', tables)).toBe('DestinySocketTypeDefinition');
    expect(resolveTableAlias('presentationnode', tables)).toBe('DestinyPresentationNodeDefinition');
    expect(resolveTableAlias('collect', tables)).toBe('DestinyCollectibleDefinition');
    expect(resolveTableAlias('nonsense', tables)).toBeNull();
    expect(resolveTableAlias('item', [LITE_TABLE])).toBe(LITE_TABLE);
  });

  it('extracts Lite inventory summaries with normalized table and hash', () => {
    const summary = extractTableEntrySummary(LITE_TABLE, '1363886209', {
      displayProperties: {
        name: 'Gjallarhorn',
        description: 'A ferocious rocket launcher.',
        icon: '/common/destiny2_content/icons/gjallarhorn.png',
        iconWatermark: '/common/destiny2_content/icons/exotic_watermark.png',
      },
      itemType: 3,
      itemSubType: 10,
      itemTypeDisplayName: 'Rocket Launcher',
      itemTypeAndTierDisplayName: 'Exotic Rocket Launcher',
      classType: 3,
      defaultDamageType: 3,
      itemCategoryHashes: [1, 2],
      inventory: { tierType: 6, tierTypeName: 'Exotic' },
      plug: { plugCategoryIdentifier: 'frames' },
      loreHash: 12345,
      screenshot: '/img/screenshots/gjallarhorn.png',
      redacted: false,
    });

    expect(summary.table).toBe(ITEM_TABLE);
    expect(summary.hash).toBe(1363886209);
    expect(summary.name).toBe('Gjallarhorn');
    expect(summary.nameLower).toBe('gjallarhorn');
    expect(summary.subtitle).toBe('Exotic Rocket Launcher');
    expect(summary.descLower).toContain('ferocious rocket launcher');
    expect(summary.icon).toBe('/common/destiny2_content/icons/gjallarhorn.png');
    expect(summary.iconWatermark).toBe('/common/destiny2_content/icons/exotic_watermark.png');
    expect(summary.tierType).toBe(6);
    expect(summary.itemType).toBe(3);
    expect(summary.itemSubType).toBe(10);
    expect(summary.classType).toBe(3);
    expect(summary.damageType).toBe(3);
    expect(summary.itemCategoryHashes).toEqual([1, 2]);
    expect(summary.plugCategoryIdentifier).toBe('frames');
    expect(summary.hasLore).toBe(true);
    expect(summary.hasScreenshot).toBe(true);
    expect(summary.isRedacted).toBe(false);
    expect(summary.isAdept).toBe(false);
    expect(summary.isDummy).toBe(false);
  });

  it('keeps non-item tables intact and detects flags', () => {
    const record = extractTableEntrySummary('DestinyRecordDefinition', '123', {
      displayProperties: { name: 'Flawless', description: 'Complete it.' },
      redacted: true,
    });
    expect(record.table).toBe('DestinyRecordDefinition');
    expect(record.subtitle).toBe('Record');
    expect(record.itemType).toBeUndefined();
    expect(record.isRedacted).toBeUndefined();

    const dummy = extractTableEntrySummary(ITEM_TABLE, '5', {
      displayProperties: { name: 'Dummy Weapon' },
      itemType: 3,
      inventory: { tierType: 6, tierTypeName: 'Adept' },
    });
    expect(dummy.isDummy).toBe(true);
    expect(dummy.isAdept).toBe(true);

    const questline = extractTableEntrySummary('DestinyRecordDefinition', '6', {
      questlineItemHash: 42,
    });
    expect(questline.name).toBe('Questline');
  });

  it('detects enhanced items from display names, plug category and name suffix', () => {
    const byTierAndType = extractTableEntrySummary(ITEM_TABLE, '1', {
      displayProperties: { name: 'Some Perk' },
      itemTypeAndTierDisplayName: 'Enhanced Trait',
      inventory: { tierType: 5 },
    });
    expect(byTierAndType.isEnhanced).toBe(true);

    const byType = extractTableEntrySummary(ITEM_TABLE, '2', {
      displayProperties: { name: 'Some Perk' },
      itemTypeDisplayName: 'Enhanced Intrinsic',
    });
    expect(byType.isEnhanced).toBe(true);

    const byPlug = extractTableEntrySummary(ITEM_TABLE, '3', {
      displayProperties: { name: 'Some Perk' },
      plug: { plugCategoryIdentifier: 'enhanced_origin_trait' },
    });
    expect(byPlug.isEnhanced).toBe(true);

    const bySuffix = extractTableEntrySummary(ITEM_TABLE, '4', {
      displayProperties: { name: "Zaouli's Bane (Enhanced)" },
    });
    expect(bySuffix.isEnhanced).toBe(true);

    const notEnhanced = extractTableEntrySummary(ITEM_TABLE, '5', {
      displayProperties: { name: "Zaouli's Bane" },
      itemTypeDisplayName: 'Hand Cannon',
    });
    expect(notEnhanced.isEnhanced).toBe(false);
  });
});

describe('query parser', () => {
  const tables = [ITEM_TABLE, 'DestinySandboxPerkDefinition', 'DestinyActivityDefinition'];

  it('keeps quoted phrases together and extracts negation', () => {
    const parsed = parseSearchQuery('"auto rifle" -engram', tables);
    expect(parsed.textTokens).toEqual(['auto rifle']);
    expect(parsed.negatedTokens).toEqual(['engram']);
    expect(parsed.hashMatches).toEqual([]);
  });

  it('parses multiple pasted hashes including signed values', () => {
    const parsed = parseSearchQuery('1363886209, 2923251173, -1368098261', tables);
    expect(parsed.hashMatches).toEqual([
      1363886209,
      2923251173,
      toUnsignedHash(-1368098261),
    ]);
    expect(parsed.textTokens).toEqual([]);
  });

  it('parses all operators', () => {
    const parsed = parseSearchQuery(
      'table:perk tier:exotic damage:solar class:hunter type:weapon cat:"auto rifle" is:adept has:lore -is:dummy',
      tables,
    );
    expect(parsed.tableFilter).toBe('DestinySandboxPerkDefinition');
    expect(parsed.tierFilters).toEqual([6]);
    expect(parsed.damageFilters).toEqual([3]);
    expect(parsed.classFilters).toEqual([1]);
    expect(parsed.typeFilters).toEqual([3]);
    expect(parsed.categoryTokens).toEqual(['auto rifle']);
    expect(parsed.flags).toEqual({ adept: true, hasLore: true, dummy: false });
  });

  it('supports operator aliases', () => {
    const parsed = parseSearchQuery('t:activity el:stasis type:shader', tables);
    expect(parsed.tableFilter).toBe('DestinyActivityDefinition');
    expect(parsed.damageFilters).toEqual([6]);
    expect(parsed.typeFilters).toEqual([20]);
  });

  it('resolves table shortcuts before the manifest has loaded', () => {
    expect(parseSearchQuery('table:perk', []).tableFilter).toBe('DestinySandboxPerkDefinition');
    expect(parseSearchQuery('table:DestinyRecordDefinition', []).tableFilter).toBe(
      'DestinyRecordDefinition',
    );
  });

  it('treats unknown prefixes as text', () => {
    const parsed = parseSearchQuery('mystery:value', tables);
    expect(parsed.textTokens).toEqual(['mystery:value']);
  });
});

describe('ranking and filtering', () => {
  const exact = makeEntry({ hash: 1, name: 'Gjallarhorn' });
  const startsWith = makeEntry({ hash: 2, name: 'Gjallarhorn Replica' });
  const wordBoundary = makeEntry({ hash: 3, name: 'The Gjallarhorn' });
  const substring = makeEntry({ hash: 4, name: 'BigGjallarhorn' });
  const subtitleMatch = makeEntry({
    hash: 5,
    name: 'Wolfpack Round',
    subtitle: 'Gjallarhorn Catalyst',
  });
  const descMatch = makeEntry({
    hash: 6,
    name: 'Rocket',
    descLower: 'the gjallarhorn returns',
  });

  it('orders exact, startsWith, word boundary, substring, subtitle, description', () => {
    const result = rank('gjallarhorn', [
      descMatch,
      subtitleMatch,
      substring,
      wordBoundary,
      startsWith,
      exact,
    ]);
    expect(result.items.map((item) => item.hash)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.totalMatches).toBe(6);
  });

  it('boosts named non-dummy entries above dummies with the same name', () => {
    const normal = makeEntry({ hash: 10, name: 'Repeatable Bounty' });
    const dummy = makeEntry({ hash: 11, name: 'Repeatable Bounty', isDummy: true });
    const result = rank('repeatable bounty', [dummy, normal]);
    expect(result.items.map((item) => item.hash)).toEqual([10, 11]);
  });

  it('requires every positive token and honours negated tokens', () => {
    const entries = [
      makeEntry({ hash: 20, name: 'Solar Auto Rifle' }),
      makeEntry({ hash: 21, name: 'Solar Hand Cannon' }),
      makeEntry({ hash: 22, name: 'Solar Auto Rifle Engram' }),
    ];
    expect(rank('solar auto', entries).items.map((item) => item.hash)).toEqual([20, 22]);
    expect(rank('solar auto -engram', entries).items.map((item) => item.hash)).toEqual([20]);
  });

  it('returns only the requested hash and ranks it first', () => {
    const entries = [
      makeEntry({ hash: 1363886209, name: 'Gjallarhorn' }),
      makeEntry({ hash: 2923251173, name: 'Other' }),
    ];
    const result = rank('1363886209', entries);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.hash).toBe(1363886209);
  });

  it('applies table, tier, damage, class and type filters', () => {
    const entries = [
      makeEntry({
        hash: 30,
        name: 'Exotic Solar Titan Weapon',
        table: ITEM_TABLE,
        tierType: 6,
        damageType: 3,
        classType: 0,
        itemType: 3,
        itemSubType: 6,
      }),
      makeEntry({
        hash: 31,
        name: 'Legendary Stasis Hunter Shader',
        table: ITEM_TABLE,
        tierType: 5,
        damageType: 6,
        classType: 1,
        itemType: 19,
        itemSubType: 20,
      }),
      makeEntry({
        hash: 32,
        name: 'Perk',
        table: 'DestinySandboxPerkDefinition',
      }),
    ];

    expect(rank('t:item tier:exotic', entries).items.map((item) => item.hash)).toEqual([30]);
    expect(rank('damage:solar class:titan', entries).items.map((item) => item.hash)).toEqual([30]);
    expect(rank('type:weapon', entries).items.map((item) => item.hash)).toEqual([30]);
    expect(rank('type:shader', entries).items.map((item) => item.hash)).toEqual([31]);
    expect(rank('type:mod', entries).items.map((item) => item.hash)).toEqual([]);
    expect(rank('t:perk', entries).items.map((item) => item.hash)).toEqual([32]);
  });

  it('applies flags and category tokens', () => {
    const entries = [
      makeEntry({
        hash: 40,
        name: 'Adept Weapon',
        isAdept: true,
        isRedacted: true,
        itemCategoryHashes: [1],
      }),
      makeEntry({ hash: 41, name: 'Regular Weapon', itemCategoryHashes: [1] }),
      makeEntry({ hash: 42, name: 'Dummy Weapon', isDummy: true, itemCategoryHashes: [1] }),
    ];

    expect(rank('is:adept', entries).items.map((item) => item.hash)).toEqual([40]);
    expect(rank('is:redacted', entries).items.map((item) => item.hash)).toEqual([40]);
    expect(rank('-is:dummy', entries).items.map((item) => item.hash)).toEqual([40, 41]);
    expect(rank('cat:"auto rifle"', entries, { categories: new Map([[1, 'Auto Rifle']]) }).items).toHaveLength(3);
  });

  it('filters by the is:enhanced flag and copies it onto results', () => {
    const entries = [
      makeEntry({ hash: 70, name: 'Enhanced Perk', isEnhanced: true }),
      makeEntry({ hash: 71, name: 'Regular Perk' }),
      makeEntry({ hash: 72, name: 'Other Enhanced', isEnhanced: true }),
    ];
    const enhanced = rank('is:enhanced', entries);
    expect(enhanced.items.map((item) => item.hash)).toEqual([70, 72]);
    expect(enhanced.items.every((item) => item.isEnhanced === true)).toBe(true);
    expect(rank('-is:enhanced', entries).items.map((item) => item.hash)).toEqual([71]);
  });

  it('applies the UI filter popover', () => {
    const entries = [
      makeEntry({
        hash: 50,
        name: 'Exotic Solar Weapon',
        tierType: 6,
        damageType: 3,
        classType: 2,
        itemType: 3,
        itemCategoryHashes: [7],
      }),
      makeEntry({
        hash: 51,
        name: 'Rare Void Armor',
        tierType: 4,
        damageType: 4,
        classType: 0,
        itemType: 2,
        itemCategoryHashes: [8],
      }),
      makeEntry({ hash: 52, name: '' }),
    ];

    const filtered = rank('', entries, {
      filters: {
        tierTypes: [6],
        damageTypes: [3],
        classTypes: [2],
        itemTypes: [3],
        itemCategoryHashes: [7],
        includeUnnamed: false,
      },
    });
    expect(filtered.items.map((item) => item.hash)).toEqual([50]);

    const redacted = rank('', entries, {
      filters: { onlyRedacted: true },
    });
    expect(redacted.items).toHaveLength(0);
  });

  it('supports all sort modes', () => {
    const entries = [
      makeEntry({ hash: 60, name: 'Charlie', index: 1 }),
      makeEntry({ hash: 62, name: 'Alpha', index: 3 }),
      makeEntry({ hash: 61, name: 'Bravo', index: 2 }),
    ];

    expect(rank('', entries, { sort: 'name-asc' }).items.map((item) => item.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
    expect(rank('', entries, { sort: 'name-desc' }).items.map((item) => item.name)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ]);
    expect(rank('', entries, { sort: 'hash-asc' }).items.map((item) => item.hash)).toEqual([
      60, 61, 62,
    ]);
    expect(rank('', entries, { sort: 'hash-desc' }).items.map((item) => item.hash)).toEqual([
      62, 61, 60,
    ]);
    expect(rank('', entries, { sort: 'index-desc' }).items.map((item) => item.hash)).toEqual([
      62, 61, 60,
    ]);
  });

  it('caps results while reporting the full match count', () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      makeEntry({ hash: index + 1, name: `Weapon ${index + 1}` }),
    );
    const result = rank('weapon', entries, { maxResults: 10 });
    expect(result.items).toHaveLength(10);
    expect(result.totalMatches).toBe(25);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('search index schema version', () => {
  it('exports a schema version so stale caches are rebuilt', () => {
    expect(SEARCH_INDEX_SCHEMA_VERSION).toBe(4);
  });
});

describe('enriched summary extraction', () => {
  it('hardens enhanced detection with name prefix and trait ids', () => {
    const byPrefix = extractTableEntrySummary(ITEM_TABLE, '10', {
      displayProperties: { name: 'Enhanced Sidearm' },
    });
    expect(byPrefix.isEnhanced).toBe(true);

    const byTrait = extractTableEntrySummary(ITEM_TABLE, '11', {
      displayProperties: { name: 'Some Perk' },
      traitIds: ['enhanced_perk'],
    });
    expect(byTrait.isEnhanced).toBe(true);
    expect(byTrait.traitIds).toEqual(['enhanced_perk']);
  });

  it('extracts ammo, bucket, season, crafting, catalyst, ornament and source metadata', () => {
    const summary = extractTableEntrySummary(ITEM_TABLE, '20', {
      displayProperties: { name: 'Revenant Sidearm' },
      itemType: 3,
      itemSubType: 17,
      equippingBlock: { ammoType: 1 },
      inventory: { bucketTypeHash: 2465295065, recipeItemHash: 12345, tierType: 5 },
      seasonHash: 123456789,
      collectibleHash: 987654321,
      flavorText: 'A relic of the Revenant episode.',
      displaySource: 'Source: Episode: Revenant',
      traitIds: ['season_25'],
      itemTypeDisplayName: 'Sidearm',
    });

    expect(summary.ammoType).toBe(1);
    expect(summary.bucketHash).toBe(2465295065);
    expect(summary.seasonHash).toBe(123456789);
    expect(summary.collectibleHash).toBe(987654321);
    expect(summary.isCraftable).toBe(true);
    expect(summary.hasFlavor).toBe(true);
    expect(summary.hasCollectible).toBe(true);
    expect(summary.sourceLower).toContain('episode: revenant');
    expect(summary.traitIds).toEqual(['season_25']);
  });

  it('detects crafting via pattern item type and catalyst/ornament via display names', () => {
    const pattern = extractTableEntrySummary(ITEM_TABLE, '30', {
      displayProperties: { name: 'Pattern' },
      itemType: 30,
    });
    expect(pattern.isCraftable).toBe(true);

    const catalyst = extractTableEntrySummary(ITEM_TABLE, '31', {
      displayProperties: { name: 'Malfeasance' },
      itemTypeDisplayName: 'Weapon Catalyst',
    });
    expect(catalyst.isCatalyst).toBe(true);

    const ornament = extractTableEntrySummary(ITEM_TABLE, '32', {
      displayProperties: { name: 'Gjallarhorn' },
      itemTypeDisplayName: 'Weapon Ornament',
    });
    expect(ornament.isOrnament).toBe(true);
  });

  it('keeps new metadata off non-item tables', () => {
    const record = extractTableEntrySummary('DestinyRecordDefinition', '40', {
      displayProperties: { name: 'Flawless' },
      seasonHash: 5,
      displaySource: 'Source: Trials of Osiris',
    });
    expect(record.seasonHash).toBe(5);
    expect(record.sourceLower).toContain('trials of osiris');
    expect(record.ammoType).toBeUndefined();
    expect(record.isCraftable).toBeUndefined();
  });
});

describe('DIM-inspired query operators', () => {
  it('filters by ammo: primary/special/heavy and numeric values', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Primary Weapon', ammoType: 1 }),
      makeEntry({ hash: 2, name: 'Special Weapon', ammoType: 2 }),
      makeEntry({ hash: 3, name: 'Heavy Weapon', ammoType: 3 }),
    ];
    expect(rank('ammo:primary', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('ammo:special', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('ammo:heavy', entries).items.map((item) => item.hash)).toEqual([3]);
    expect(rank('ammo:2', entries).items.map((item) => item.hash)).toEqual([2]);
  });

  it('filters by slot: using bucket aliases and numeric hashes', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Kinetic Weapon', bucketHash: 1498876634 }),
      makeEntry({ hash: 2, name: 'Energy Weapon', bucketHash: 2465295065 }),
      makeEntry({ hash: 3, name: 'Power Weapon', bucketHash: 953998645 }),
      makeEntry({ hash: 4, name: 'Helmet', bucketHash: 3448274439 }),
    ];
    expect(rank('slot:kinetic', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('slot:energy', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('slot:heavy', entries).items.map((item) => item.hash)).toEqual([3]);
    expect(rank('slot:head', entries).items.map((item) => item.hash)).toEqual([4]);
    expect(rank('slot:2465295065', entries).items.map((item) => item.hash)).toEqual([2]);
  });

  it('filters by subtype: / weapon: using DestinyItemSubType names', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Auto Rifle', itemSubType: 6 }),
      makeEntry({ hash: 2, name: 'Grenade Launcher', itemSubType: 23 }),
      makeEntry({ hash: 3, name: 'Bow', itemSubType: 31 }),
      makeEntry({ hash: 4, name: 'Sword', itemSubType: 18 }),
    ];
    expect(rank('subtype:auto', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('weapon:grenade', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('subtype:gl', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('weapon:bow', entries).items.map((item) => item.hash)).toEqual([3]);
    expect(rank('subtype:smg', entries).items.map((item) => item.hash)).toEqual([]);
  });

  it('filters by season: numeric, latest/current and name fragments', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Wish Item', seasonNumber: 24 }),
      makeEntry({ hash: 2, name: 'Revenant Item', seasonNumber: 25 }),
      makeEntry({ hash: 3, name: 'No Season' }),
    ];
    const context: SearchContext = {
      latestSeason: 25,
      seasonNameMap: new Map([
        [24, 'Season of the Wish'],
        [25, 'Episode: Revenant'],
      ]),
    };
    expect(rank('season:25', entries, { context }).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('season:latest', entries, { context }).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('season:current', entries, { context }).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('season:revenant', entries, { context }).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('s:24', entries, { context }).items.map((item) => item.hash)).toEqual([1]);
  });

  it('filters by source: against sourceLower and descLower, with negation', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Raid Item', sourceLower: 'source: last wish raid' }),
      makeEntry({ hash: 2, name: 'Dungeon Item', sourceLower: 'source: shattered throne dungeon' }),
      makeEntry({ hash: 3, name: 'Trials Item', descLower: 'earn from trials of osiris' }),
    ];
    expect(rank('source:raid', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('source:dungeon', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('source:trials', entries).items.map((item) => item.hash)).toEqual([3]);
    expect(rank('-source:raid', entries).items.map((item) => item.hash)).toEqual([2, 3]);
  });

  it('filters by trait: substring with negation', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Enhanced Perk', traitIds: ['enhanced', 'barrel'] }),
      makeEntry({ hash: 2, name: 'Regular Perk', traitIds: ['barrel'] }),
      makeEntry({ hash: 3, name: 'No Traits' }),
    ];
    expect(rank('trait:enhanced', entries, { sort: 'hash-asc' }).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('-trait:enhanced', entries, { sort: 'hash-asc' }).items.map((item) => item.hash)).toEqual([2, 3]);
  });

  it('filters by is:artifact with aliases', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Artifact Mod', isArtifact: true }),
      makeEntry({ hash: 2, name: 'Artifact Perk', isArtifactPerk: true }),
      makeEntry({ hash: 3, name: 'Normal Mod' }),
    ];
    expect(rank('is:artifact', entries).items.map((item) => item.hash)).toEqual([1, 2]);
    expect(rank('is:artifactperk', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('is:seasonalartifact', entries).items.map((item) => item.hash)).toEqual([1, 2]);
  });

  it('filters by is:craftable / is:catalyst / is:ornament', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Craftable Weapon', isCraftable: true }),
      makeEntry({ hash: 2, name: 'Catalyst', isCatalyst: true }),
      makeEntry({ hash: 3, name: 'Ornament', isOrnament: true }),
      makeEntry({ hash: 4, name: 'Plain Weapon' }),
    ];
    expect(rank('is:craftable', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('is:crafted', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('is:catalyst', entries).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('is:ornament', entries).items.map((item) => item.hash)).toEqual([3]);
  });

  it('filters by has:watermark', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Watermarked', iconWatermark: '/img/wm.png' }),
      makeEntry({ hash: 2, name: 'Plain' }),
    ];
    expect(rank('has:watermark', entries).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('has:watermark', [entries[1]!]).items).toHaveLength(0);
  });

  it('supports convenience is:exotic and is:solar aliases', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Exotic Solar', tierType: 6, damageType: 3, itemType: 3 }),
      makeEntry({ hash: 2, name: 'Legendary Solar', tierType: 5, damageType: 3, itemType: 3 }),
      makeEntry({ hash: 3, name: 'Exotic Arc', tierType: 6, damageType: 2, itemType: 3 }),
    ];
    expect(rank('is:exotic', entries, { sort: 'hash-asc' }).items.map((item) => item.hash)).toEqual([1, 3]);
    expect(rank('is:solar', entries, { sort: 'hash-asc' }).items.map((item) => item.hash)).toEqual([1, 2]);
    expect(rank('is:weapon', entries, { sort: 'hash-asc' }).items.map((item) => item.hash)).toEqual([1, 2, 3]);
  });
});

describe('d2ai bundled mappings', () => {
  it('ships bundled season, craftable and source mappings', () => {
    const mappings = getD2aiMappings();
    expect(Object.keys(mappings.watermarkToSeason).length).toBeGreaterThan(0);
    expect(Object.keys(mappings.itemHashToSeason).length).toBeGreaterThan(4000);
    expect(Object.keys(mappings.sourceHashToSeason).length).toBeGreaterThan(0);
    expect(mappings.craftableHashes.size).toBe(219);
  });

  it('covers seasons 1..28 with fallback names and aliases', () => {
    expect(Object.keys(SEASON_ALIASES).length).toBe(28);
    expect(SEASON_ALIASES[1]?.fallbackName).toBe('Red War');
    expect(SEASON_ALIASES[2]?.fallbackName).toBe('Curse of Osiris');
    expect(SEASON_ALIASES[26]?.fallbackName).toBe('Heresy');
    expect(SEASON_ALIASES[27]?.fallbackName).toBe('Edge of Fate');
    expect(SEASON_ALIASES[28]?.fallbackName).toBe('Renegades');
    expect(SEASON_ALIASES[24]?.aliases).toContain('final shape');
    expect(SEASON_ALIASES[27]?.aliases).toContain('edge of fate');
    expect(SEASON_ALIASES[28]?.aliases).toContain('renegades');
    expect(SEASON_ALIASES[28]?.aliases).toContain('lawless');
    expect(SEASON_ALIASES[28]?.aliases).toContain('monument of triumph');
  });
});

describe('artifact perks virtual table', () => {
  it('resolves artifact perk aliases to the virtual table', () => {
    const tables = [ITEM_TABLE, ARTIFACT_PERKS_TABLE];
    expect(resolveTableAlias('artifactperk', tables)).toBe(ARTIFACT_PERKS_TABLE);
    expect(resolveTableAlias('artifactperks', tables)).toBe(ARTIFACT_PERKS_TABLE);
    expect(resolveTableAlias('artifactmod', tables)).toBe(ARTIFACT_PERKS_TABLE);
    expect(resolveTableAlias('artifactmods', tables)).toBe(ARTIFACT_PERKS_TABLE);
  });

  it('detects artifact perks from item type display and plug category', () => {
    const byType = extractTableEntrySummary(ITEM_TABLE, '1', {
      displayProperties: { name: 'Anti-Barrier Pulse' },
      itemTypeDisplayName: 'Artifact Perk',
    });
    expect(byType.isArtifactPerk).toBe(true);

    const byPlug = extractTableEntrySummary(ITEM_TABLE, '2', {
      displayProperties: { name: 'Overload Auto Rifle' },
      plug: { plugCategoryIdentifier: 'artifact_perks' },
    });
    expect(byPlug.isArtifactPerk).toBe(true);

    const notArtifact = extractTableEntrySummary(ITEM_TABLE, '3', {
      displayProperties: { name: 'Regular Mod' },
      itemTypeDisplayName: 'Weapon Mod',
    });
    expect(notArtifact.isArtifactPerk).toBe(false);
  });

  it('filters table:artifactperks by isArtifactPerk and copies parent artifact metadata', () => {
    const entries = [
      makeEntry({
        hash: 1,
        name: 'Anti-Barrier Pulse',
        isArtifactPerk: true,
        parentArtifactHash: 111,
        parentArtifactName: 'Tablet of Ruin',
        parentArtifactIcon: '/img/tablet.png',
      }),
      makeEntry({ hash: 2, name: 'Regular Mod' }),
      makeEntry({ hash: 3, name: 'Other Artifact Perk', isArtifactPerk: true }),
    ];
    const parsed = parseSearchQuery('table:artifactperks', [ITEM_TABLE, ARTIFACT_PERKS_TABLE]);
    const result = scoreAndFilterEntries(
      entries,
      parsed,
      makeFilters(),
      'relevance',
      new Map(),
      undefined,
      { latestSeason: 26, seasonNameMap: new Map(), seasonAliases: SEASON_ALIASES },
    );
    expect(result.items.map((item) => item.hash)).toEqual([1, 3]);
    expect(result.items[0]?.isArtifactPerk).toBe(true);
    expect(result.items[0]?.parentArtifactHash).toBe(111);
    expect(result.items[0]?.parentArtifactName).toBe('Tablet of Ruin');
    expect(result.items[0]?.parentArtifactIcon).toBe('/img/tablet.png');
  });

  it('finds artifact perks by parent artifact name via free text', () => {
    const entries = [
      makeEntry({
        hash: 1,
        name: 'Anti-Barrier Pulse',
        isArtifactPerk: true,
        parentArtifactName: 'Encrypted Data Disk',
      }),
      makeEntry({ hash: 2, name: 'Unrelated Mod' }),
    ];
    expect(rank('encrypted data disk', entries).items.map((item) => item.hash)).toEqual([1]);
  });
});

describe('season alias resolution', () => {
  it('resolves season:heresy / season:renegades / season:26 / season:latest', () => {
    const entries = [
      makeEntry({ hash: 1, name: 'Heresy Item', seasonNumber: 26 }),
      makeEntry({ hash: 2, name: 'Renegades Item', seasonNumber: 28 }),
      makeEntry({ hash: 3, name: 'Final Shape Item', seasonNumber: 24 }),
      makeEntry({ hash: 4, name: 'No Season' }),
    ];
    const context: SearchContext = {
      latestSeason: 28,
      seasonNameMap: new Map([[26, 'Episode: Heresy']]),
      seasonAliases: SEASON_ALIASES,
    };
    expect(rank('season:heresy', entries, { context }).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('season:renegades', entries, { context }).items.map((item) => item.hash)).toEqual([
      2,
    ]);
    expect(rank('season:26', entries, { context }).items.map((item) => item.hash)).toEqual([1]);
    expect(rank('season:latest', entries, { context }).items.map((item) => item.hash)).toEqual([2]);
    expect(rank('season:"final shape"', entries, { context }).items.map((item) => item.hash)).toEqual(
      [3],
    );
    expect(rank('season:"edge of fate"', entries, { context }).items.map((item) => item.hash)).toEqual(
      [],
    );
  });
});

describe('JSON diff', () => {
  it('reports nested additions, removals and changes', () => {
    const left = { a: 1, b: { c: 2, d: 3 }, list: [1, 2] };
    const right = { a: 1, b: { c: 5, e: 4 }, list: [1, 3, 4] };
    const diff = computeJsonDiff(left, right);

    expect(diff).toEqual([
      { path: 'b.c', kind: 'changed', left: 2, right: 5 },
      { path: 'b.d', kind: 'removed', left: 3 },
      { path: 'b.e', kind: 'added', right: 4 },
      { path: 'list[1]', kind: 'changed', left: 2, right: 3 },
      { path: 'list[2]', kind: 'added', right: 4 },
    ]);
  });

  it('returns no entries for deeply equal values', () => {
    expect(computeJsonDiff({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] })).toEqual([]);
    expect(computeJsonDiff(null, null)).toEqual([]);
  });

  it('reports root changes and type changes', () => {
    expect(computeJsonDiff(1, 2)).toEqual([
      { path: '$', kind: 'changed', left: 1, right: 2 },
    ]);
    expect(computeJsonDiff({ a: { x: 1 } }, { a: [1] })).toEqual([
      { path: 'a', kind: 'changed', left: { x: 1 }, right: [1] },
    ]);
    expect(computeJsonDiff({ a: null }, {})).toEqual([
      { path: 'a', kind: 'removed', left: null },
    ]);
  });

  it('supports a base path', () => {
    const diff = computeJsonDiff({ value: 1 }, { value: 2 }, 'payload');
    expect(diff).toEqual([
      { path: 'payload.value', kind: 'changed', left: 1, right: 2 },
    ]);
  });

  it('does not throw on cyclic objects', () => {
    const left: Record<string, unknown> = { value: 1 };
    left.self = left;
    const right: Record<string, unknown> = { value: 2 };
    right.self = right;
    expect(() => computeJsonDiff(left, right)).not.toThrow();
  });

  it('caps output for very large arrays', () => {
    const left = new Array<number>(20_000).fill(0);
    const right = new Array<number>(20_000).fill(1);
    const diff = computeJsonDiff(left, right);
    expect(diff.length).toBe(5000);
    expect(diff[0]).toMatchObject({ path: '[0]', kind: 'changed', left: 0, right: 1 });
  });

  it('stops descending at the depth limit', () => {
    const makeDeep = (leaf: number) => {
      const root: Record<string, unknown> = {};
      let cursor = root;
      for (let index = 0; index < 100; index += 1) {
        const next: Record<string, unknown> = {};
        cursor.child = next;
        cursor = next;
      }
      cursor.leaf = leaf;
      return root;
    };

    const diff = computeJsonDiff(makeDeep(1), makeDeep(2));
    expect(diff).toHaveLength(1);
    expect(diff[0]?.kind).toBe('changed');
    expect(diff[0]?.path.startsWith('child.child')).toBe(true);
  });
});
