import type { FilterOption } from '../types/manifest';

/** Maps a numeric enum value to its Bungie member name. */
export type EnumMap = Readonly<Record<number, string>>;

export interface EnumAnnotation {
  enumName: string;
  label: string;
  isBitmask?: boolean;
}

interface EnumDefinition {
  name: string;
  values: EnumMap;
  isBitmask?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Item level enums                                                           */
/* -------------------------------------------------------------------------- */

export const DestinyItemType: EnumMap = {
  0: 'None',
  1: 'Currency',
  2: 'Armor',
  3: 'Weapon',
  7: 'Message',
  8: 'Engram',
  9: 'Consumable',
  10: 'ExchangeMaterial',
  11: 'MissionReward',
  12: 'QuestStep',
  13: 'QuestStepComplete',
  14: 'Emblem',
  15: 'Quest',
  16: 'Subclass',
  17: 'ClanBanner',
  18: 'Aura',
  19: 'Mod',
  20: 'Dummy',
  21: 'Ship',
  22: 'Vehicle',
  23: 'Emote',
  24: 'Ghost',
  25: 'Package',
  26: 'Bounty',
  27: 'Wrapper',
  28: 'SeasonalArtifact',
  29: 'Finisher',
  30: 'Pattern',
};

export const DestinyItemSubType: EnumMap = {
  0: 'None',
  1: 'Crucible',
  2: 'Vanguard',
  5: 'Exotic',
  6: 'AutoRifle',
  7: 'Shotgun',
  8: 'Machinegun',
  9: 'HandCannon',
  10: 'RocketLauncher',
  11: 'FusionRifle',
  12: 'SniperRifle',
  13: 'PulseRifle',
  14: 'ScoutRifle',
  16: 'Crm',
  17: 'Sidearm',
  18: 'Sword',
  19: 'Mask',
  20: 'Shader',
  21: 'Ornament',
  22: 'FusionRifleLine',
  23: 'GrenadeLauncher',
  24: 'SubmachineGun',
  25: 'TraceRifle',
  26: 'HelmetArmor',
  27: 'GauntletsArmor',
  28: 'ChestArmor',
  29: 'LegArmor',
  30: 'ClassArmor',
  31: 'Bow',
  32: 'DummyRepeatableBounty',
  33: 'Glaive',
};

export const SpecialItemType: EnumMap = {
  0: 'None',
  1: 'SpecialCurrency',
  8: 'Armor',
  9: 'Weapon',
  23: 'Engram',
  24: 'Consumable',
  25: 'ExchangeMaterial',
  27: 'MissionReward',
  29: 'Currency',
};

export const TierType: EnumMap = {
  0: 'Unknown',
  1: 'Currency',
  2: 'Basic',
  3: 'Common',
  4: 'Rare',
  5: 'Superior',
  6: 'Exotic',
};

export const DestinyClass: EnumMap = {
  0: 'Titan',
  1: 'Hunter',
  2: 'Warlock',
  3: 'Unknown',
};

export const DamageType: EnumMap = {
  0: 'None',
  1: 'Kinetic',
  2: 'Arc',
  3: 'Solar',
  4: 'Void',
  5: 'Raid',
  6: 'Stasis',
  7: 'Strand',
};

export const DestinyAmmunitionType: EnumMap = {
  0: 'None',
  1: 'Primary',
  2: 'Special',
  3: 'Heavy',
  4: 'Unknown',
};

export const DestinyBreakerType: EnumMap = {
  0: 'None',
  1: 'ShieldPiercing',
  2: 'Disruption',
  3: 'Stagger',
};

export const DestinyEnergyType: EnumMap = {
  0: 'Any',
  1: 'Arc',
  2: 'Solar',
  3: 'Void',
  4: 'Ghost',
  5: 'Subclass',
  6: 'Stasis',
  7: 'Strand',
};

export const DestinyScope: EnumMap = {
  0: 'Profile',
  1: 'Character',
};

export const DestinyGatingScope: EnumMap = {
  0: 'None',
  1: 'Global',
  2: 'Clan',
  3: 'Profile',
  4: 'Character',
  5: 'Item',
  6: 'AssumedWorstCase',
};

/* -------------------------------------------------------------------------- */
/* Weapon / stat / socket enums                                               */
/* -------------------------------------------------------------------------- */

export const DestinyStatAggregationType: EnumMap = {
  0: 'CharacterAverage',
  1: 'Character',
  2: 'Item',
};

export const DestinyStatCategory: EnumMap = {
  0: 'Gameplay',
  1: 'Weapon',
  2: 'Defense',
  3: 'Primary',
};

/** Flags: a socket may source plugs from several places at once. */
export const SocketPlugSources: EnumMap = {
  0: 'None',
  1: 'InventorySourced',
  2: 'ReusablePlugItems',
  4: 'ProfilePlugSet',
  8: 'CharacterPlugSet',
};

/** Flags: styling hints for plug items. */
export const PlugUiStyles: EnumMap = {
  0: 'None',
  1: 'Masterwork',
};

export const PlugAvailabilityMode: EnumMap = {
  0: 'Normal',
  1: 'UnavailableIfSocketContainsMatchingPlugCategory',
  2: 'AvailableIfSocketContainsMatchingPlugCategory',
};

export const SocketCategoryStyle: EnumMap = {
  0: 'Unknown',
  1: 'Reusable',
  2: 'Consumable',
  3: 'Unlockable',
  4: 'Intrinsic',
  5: 'EnergyMeter',
  6: 'LargePerk',
  7: 'Abilities',
  8: 'Supers',
};

/* -------------------------------------------------------------------------- */
/* Presentation / records / activities                                        */
/* -------------------------------------------------------------------------- */

export const DestinyPresentationNodeType: EnumMap = {
  0: 'Default',
  1: 'Category',
  2: 'Collectibles',
  3: 'Records',
  4: 'Metric',
  5: 'Craftable',
};

export const DestinyPresentationDisplayStyle: EnumMap = {
  0: 'Category',
  1: 'Badge',
  2: 'Medals',
  3: 'Collectible',
  4: 'Record',
  5: 'SeasonalTriumph',
  6: 'GuardianRank',
  7: 'CategoryCollectibles',
  8: 'CategoryCurrencies',
  9: 'CategoryEmblems',
  10: 'CategoryEmotes',
  11: 'CategoryEngrams',
  12: 'CategoryFinishers',
  13: 'CategoryGhosts',
  14: 'CategoryMisc',
  15: 'CategoryMods',
  16: 'CategoryOrnaments',
  17: 'CategoryShaders',
  18: 'CategoryShips',
  19: 'CategorySpawnfx',
  20: 'CategoryUpgradeMaterials',
};

export const DestinyPresentationScreenStyle: EnumMap = {
  0: 'Default',
  1: 'CategorySets',
  2: 'Badge',
};

export const DestinyRecordValueStyle: EnumMap = {
  0: 'Integer',
  1: 'Percentage',
  2: 'Milliseconds',
  3: 'Boolean',
  4: 'Decimal',
};

export const DestinyRecordToastStyle: EnumMap = {
  0: 'None',
  1: 'Record',
  2: 'Lore',
  3: 'Badge',
  4: 'MetaRecord',
  5: 'MedalComplete',
  6: 'SeasonChallengeComplete',
  7: 'GildedTitleComplete',
  8: 'CraftingRecipeUnlocked',
  9: 'ToastGuardianRankDetails',
  10: 'PathfinderObjectiveCompleteRituals',
  11: 'PathfinderObjectiveCompleteSchism',
  12: 'PathfinderObjectiveCompletePvp',
  13: 'PathfinderObjectiveCompleteStrikes',
  14: 'PathfinderObjectiveCompleteGambit',
  15: 'SeasonWeeklyComplete',
  16: 'SeasonDailyComplete',
};

export const DestinyActivityModeType: EnumMap = {
  0: 'None',
  2: 'Story',
  3: 'Strike',
  4: 'Raid',
  5: 'AllPvP',
  6: 'Patrol',
  7: 'AllPvE',
  9: 'Reserved9',
  10: 'Control',
  11: 'Reserved11',
  12: 'Clash',
  13: 'Reserved13',
  15: 'CrimsonDoubles',
  16: 'Nightfall',
  17: 'HeroicNightfall',
  18: 'AllStrikes',
  19: 'IronBanner',
  20: 'Reserved20',
  21: 'Reserved21',
  22: 'Reserved22',
  24: 'Reserved24',
  25: 'AllMayhem',
  26: 'Reserved26',
  27: 'Reserved27',
  28: 'Reserved28',
  29: 'Reserved29',
  30: 'Reserved30',
  31: 'Supremacy',
  32: 'PrivateMatchesAll',
  37: 'Survival',
  38: 'Countdown',
  39: 'TrialsOfTheNine',
  40: 'Social',
  41: 'TrialsCountdown',
  42: 'TrialsSurvival',
  43: 'IronBannerControl',
  44: 'IronBannerClash',
  45: 'IronBannerSupremacy',
  46: 'ScoredNightfall',
  47: 'ScoredHeroicNightfall',
  48: 'Rumble',
  49: 'AllDoubles',
  50: 'Doubles',
  51: 'PrivateMatchesClash',
  52: 'PrivateMatchesControl',
  53: 'PrivateMatchesSupremacy',
  54: 'PrivateMatchesCountdown',
  55: 'PrivateMatchesSurvival',
  56: 'PrivateMatchesMayhem',
  57: 'PrivateMatchesRumble',
  58: 'HeroicAdventure',
  59: 'Showdown',
  60: 'Lockdown',
  61: 'Scorched',
  62: 'ScorchedTeam',
  63: 'Gambit',
  64: 'AllPvECompetitive',
  65: 'Breakthrough',
  66: 'BlackArmoryRun',
  67: 'Salvage',
  68: 'IronBannerSalvage',
  69: 'PvPCompetitive',
  70: 'PvPQuickplay',
  71: 'ClashQuickplay',
  72: 'ClashCompetitive',
  73: 'ControlQuickplay',
  74: 'ControlCompetitive',
  75: 'GambitPrime',
  76: 'Reckoning',
  77: 'Menagerie',
  78: 'VexOffensive',
  79: 'NightmareHunt',
  80: 'Elimination',
  81: 'Momentum',
  82: 'Dungeon',
  83: 'Sundial',
  84: 'TrialsOfOsiris',
  85: 'Dares',
  86: 'Offensive',
  87: 'LostSector',
  88: 'Rift',
  89: 'ZoneControl',
  90: 'IronBannerRift',
  91: 'IronBannerZoneControl',
  92: 'Relic',
};

export const DestinyActivityModeCategory: EnumMap = {
  0: 'None',
  1: 'PvE',
  2: 'PvP',
  3: 'PvECompetitive',
};

/* -------------------------------------------------------------------------- */
/* Inventory / buckets / progression / vendors                                */
/* -------------------------------------------------------------------------- */

export const BucketScope: EnumMap = {
  0: 'Character',
  1: 'Account',
};

export const BucketCategory: EnumMap = {
  0: 'Invisible',
  1: 'Item',
  2: 'Currency',
  3: 'Equippable',
  4: 'Ignored',
};

export const ItemLocation: EnumMap = {
  0: 'Unknown',
  1: 'Inventory',
  2: 'Vault',
  3: 'Vendor',
  4: 'Postmaster',
};

/** Flags: equipping attributes of an item. */
export const EquippingItemBlockAttributes: EnumMap = {
  0: 'None',
  1: 'EquipOnAcquire',
};

export const DestinyUnlockValueUIStyle: EnumMap = {
  0: 'Automatic',
  1: 'Fraction',
  2: 'Checkbox',
  3: 'Percentage',
  4: 'DateTime',
  5: 'FractionFloat',
  6: 'Integer',
  7: 'TimeDuration',
  8: 'Hidden',
  9: 'Multiplier',
  10: 'GreenPips',
  11: 'RedPips',
  12: 'ExplicitPercentage',
  13: 'RawFloat',
  14: 'LevelAndReward',
};

export const DestinyProgressionScope: EnumMap = {
  0: 'Account',
  1: 'Character',
  2: 'Clan',
  3: 'Item',
  4: 'ImplicitFromEquipment',
  5: 'Mapped',
  6: 'MappedAggregate',
  7: 'MappedStat',
  8: 'MappedUnlockValue',
};

export const DestinyProgressionStepDisplayEffect: EnumMap = {
  0: 'None',
  1: 'Character',
  2: 'Item',
};

export const VendorDisplayCategorySortOrder: EnumMap = {
  0: 'Default',
  1: 'SortByTier',
};

export const DestinyVendorInteractionRewardSelection: EnumMap = {
  0: 'None',
  1: 'One',
  2: 'All',
};

export const DestinyVendorReplyType: EnumMap = {
  0: 'Accept',
  1: 'Decline',
  2: 'Complete',
};

export const DestinySocketVisibility: EnumMap = {
  0: 'Visible',
  1: 'Hidden',
  2: 'HiddenWhenEmpty',
  3: 'HiddenIfNoPlugsAvailable',
};

export const DestinyObjectiveGrantStyle: EnumMap = {
  0: 'WhenIncomplete',
  1: 'WhenComplete',
  2: 'Always',
};

export const DestinyObjectiveUiStyle: EnumMap = {
  0: 'None',
  1: 'Highlighted',
  2: 'CraftingWeaponLevel',
  3: 'CraftingWeaponLevelProgress',
  4: 'CraftingWeaponTimestamp',
  5: 'CraftingMementos',
  6: 'CraftingMementoTitle',
  7: 'DiscoverableMystery0',
  8: 'DiscoverableMystery1',
  9: 'DiscoverableMystery2',
  10: 'DiscoverableMystery3',
  11: 'DiscoverableMystery4',
  12: 'DiscoverableExotic',
};

/* -------------------------------------------------------------------------- */
/* Records / collectibles / vendors / misc                                    */
/* -------------------------------------------------------------------------- */

/** Flags: redemption and visibility state of a record. */
export const DestinyRecordState: EnumMap = {
  0: 'None',
  1: 'RecordRedeemed',
  2: 'RewardUnavailable',
  4: 'ObjectiveNotCompleted',
  8: 'Obscured',
  16: 'Invisible',
  32: 'EntitlementUnowned',
  64: 'CanEquipTitle',
};

/** Flags: acquisition and availability state of a collectible. */
export const DestinyCollectibleState: EnumMap = {
  0: 'None',
  1: 'NotAcquired',
  2: 'Obscured',
  4: 'Invisible',
  8: 'CannotAffordMaterialRequirements',
  16: 'InventorySpaceUnavailable',
  32: 'UniquenessViolation',
  64: 'PurchaseDisabled',
};

export const DestinyItemSortType: EnumMap = {
  0: 'ItemId',
  1: 'Timestamp',
  2: 'DisplayName',
};

export const DestinyVendorItemRefundPolicy: EnumMap = {
  0: 'NotRefundable',
  1: 'DeletesItem',
  2: 'RevokesLicense',
};

export const DestinyActivityNavPointType: EnumMap = {
  0: 'Inactive',
  1: 'Primary',
  2: 'Secondary',
};

export const DestinyRewardSourceCategory: EnumMap = {
  0: 'None',
  1: 'Activity',
  2: 'Vendor',
  3: 'Aggregate',
};

export const DestinyRace: EnumMap = {
  0: 'Human',
  1: 'Awoken',
  2: 'Exo',
  3: 'Unknown',
};

export const DestinyGender: EnumMap = {
  0: 'Male',
  1: 'Female',
  2: 'Unknown',
};

export const DestinyGraphNodeState: EnumMap = {
  0: 'Hidden',
  1: 'Visible',
  2: 'Teaser',
  3: 'Incomplete',
  4: 'Completed',
};

export const DestinyProgressionRewardItemAcquisitionBehavior: EnumMap = {
  0: 'Instant',
  1: 'PlayerClaimRequired',
};

export const DestinyUnlockStatus: EnumMap = {
  0: 'None',
  1: 'NotUnlocked',
  2: 'Unlocked',
};

/** Flags: reasons an item cannot be equipped. */
export const EquipFailureReason: EnumMap = {
  0: 'None',
  1: 'ItemUnequippable',
  2: 'ItemUniqueEquipRestricted',
  4: 'ItemFailedUnlockCheck',
  8: 'ItemFailedLevelCheck',
  16: 'ItemWornOut',
  32: 'ItemNotOnCharacter',
};

/** Flags: reasons an activity join is closed. */
export const DestinyJoinClosedReasons: EnumMap = {
  0: 'None',
  1: 'InMatchmaking',
  2: 'LoadingDisallowed',
  4: 'SolosDisallowed',
  8: 'ReachedMaxFireteamSize',
  16: 'ReachedMaxNumMembers',
};

export const DestinyVendorFilter: EnumMap = {
  0: 'None',
  1: 'ApiPurchasable',
};

export const BungieMembershipType: EnumMap = {
  0: 'None',
  1: 'TigerXbox',
  2: 'TigerPsn',
  4: 'TigerBlizzard',
  10: 'TigerDemon',
  254: 'BungieNext',
  [-1]: 'All',
};

/** Flags: weapon performance attributes affected by a talent node step. */
export const DestinyTalentNodeStepWeaponPerformances: EnumMap = {
  0: 'None',
  1: 'RateOfFire',
  2: 'Damage',
  4: 'Accuracy',
  8: 'Range',
  16: 'Zoom',
  32: 'Recoil',
  64: 'Ready',
  128: 'Reload',
  256: 'HairTrigger',
  512: 'AmmoAndMagazine',
  1024: 'TrackingAndDetonation',
  2048: 'ShotgunSpread',
  4096: 'ChargeTime',
  8191: 'All',
};

/** Flags: impact effects a talent node step applies. */
export const DestinyTalentNodeStepImpactEffects: EnumMap = {
  0: 'None',
  1: 'ArmorPiercing',
  2: 'Ricochet',
  4: 'Flinch',
  8: 'CollateralDamage',
  16: 'Disorient',
  32: 'HighlightEnemy',
  63: 'All',
};

/** Flags: guardian attributes affected by a talent node step. */
export const DestinyTalentNodeStepGuardianAttributes: EnumMap = {
  0: 'None',
  1: 'Stats',
  2: 'Shields',
  4: 'Health',
  8: 'Revive',
  16: 'AimUnderFire',
  32: 'Radar',
  64: 'Invisibility',
  128: 'Reputations',
  255: 'All',
};

/** Flags: light abilities affected by a talent node step. */
export const DestinyTalentNodeStepLightAbilities: EnumMap = {
  0: 'None',
  1: 'Grenades',
  2: 'Melee',
  4: 'MovementModes',
  8: 'Orbs',
  16: 'SuperEnergy',
  32: 'SuperMods',
  63: 'All',
};

/** Flags: damage types affected by a talent node step. */
export const DestinyTalentNodeStepDamageTypes: EnumMap = {
  0: 'None',
  1: 'Kinetic',
  2: 'Arc',
  4: 'Solar',
  8: 'Void',
  15: 'All',
};

/* -------------------------------------------------------------------------- */
/* Annotation lookup                                                          */
/* -------------------------------------------------------------------------- */

function definition(name: string, values: EnumMap, isBitmask = false): EnumDefinition {
  return { name, values, isBitmask };
}

const ANNOTATION_FIELDS: Readonly<Record<string, EnumDefinition>> = {
  itemtype: definition('DestinyItemType', DestinyItemType),
  itemsubtype: definition('DestinyItemSubType', DestinyItemSubType),
  specialitemtype: definition('SpecialItemType', SpecialItemType),
  tiertype: definition('TierType', TierType),
  classtype: definition('DestinyClass', DestinyClass),
  class: definition('DestinyClass', DestinyClass),
  damagetype: definition('DamageType', DamageType),
  defaultdamagetype: definition('DamageType', DamageType),
  damagetypehashes: definition('DamageType', DamageType),
  ammunitiontype: definition('DestinyAmmunitionType', DestinyAmmunitionType),
  ammotype: definition('DestinyAmmunitionType', DestinyAmmunitionType),
  breakertype: definition('DestinyBreakerType', DestinyBreakerType),
  energytype: definition('DestinyEnergyType', DestinyEnergyType),
  scope: definition('DestinyScope', DestinyScope),
  gatingscope: definition('DestinyGatingScope', DestinyGatingScope),
  stataggregationtype: definition('DestinyStatAggregationType', DestinyStatAggregationType),
  statcategory: definition('DestinyStatCategory', DestinyStatCategory),
  plugsources: definition('SocketPlugSources', SocketPlugSources, true),
  socketplugsources: definition('SocketPlugSources', SocketPlugSources, true),
  plugstyle: definition('PlugUiStyles', PlugUiStyles, true),
  plugstyles: definition('PlugUiStyles', PlugUiStyles, true),
  pluguistyles: definition('PlugUiStyles', PlugUiStyles, true),
  uistyles: definition('PlugUiStyles', PlugUiStyles, true),
  alternateplugstyle: definition('PlugUiStyles', PlugUiStyles, true),
  availabilitymode: definition('PlugAvailabilityMode', PlugAvailabilityMode),
  plugavailabilitymode: definition('PlugAvailabilityMode', PlugAvailabilityMode),
  socketcategorystyle: definition('SocketCategoryStyle', SocketCategoryStyle),
  categorystyle: definition('SocketCategoryStyle', SocketCategoryStyle),
  presentationnodetype: definition('DestinyPresentationNodeType', DestinyPresentationNodeType),
  nodetype: definition('DestinyPresentationNodeType', DestinyPresentationNodeType),
  presentationdisplaystyle: definition('DestinyPresentationDisplayStyle', DestinyPresentationDisplayStyle),
  displaystyle: definition('DestinyPresentationDisplayStyle', DestinyPresentationDisplayStyle),
  presentationscreenstyle: definition('DestinyPresentationScreenStyle', DestinyPresentationScreenStyle),
  screenstyle: definition('DestinyPresentationScreenStyle', DestinyPresentationScreenStyle),
  recordvaluestyle: definition('DestinyRecordValueStyle', DestinyRecordValueStyle),
  valuestyle: definition('DestinyRecordValueStyle', DestinyRecordValueStyle),
  recordtoaststyle: definition('DestinyRecordToastStyle', DestinyRecordToastStyle),
  toaststyle: definition('DestinyRecordToastStyle', DestinyRecordToastStyle),
  activitymodetype: definition('DestinyActivityModeType', DestinyActivityModeType),
  modetype: definition('DestinyActivityModeType', DestinyActivityModeType),
  activitymodecategory: definition('DestinyActivityModeCategory', DestinyActivityModeCategory),
  modecategory: definition('DestinyActivityModeCategory', DestinyActivityModeCategory),
  bucketscope: definition('BucketScope', BucketScope),
  bucketcategory: definition('BucketCategory', BucketCategory),
  location: definition('ItemLocation', ItemLocation),
  itemlocation: definition('ItemLocation', ItemLocation),
  equippingblockattributes: definition(
    'EquippingItemBlockAttributes',
    EquippingItemBlockAttributes,
    true,
  ),
  equippingitemblockattributes: definition(
    'EquippingItemBlockAttributes',
    EquippingItemBlockAttributes,
    true,
  ),
  equippingattributes: definition('EquippingItemBlockAttributes', EquippingItemBlockAttributes, true),
  unlockvalueuistyle: definition('DestinyUnlockValueUIStyle', DestinyUnlockValueUIStyle),
  progressionscope: definition('DestinyProgressionScope', DestinyProgressionScope),
  destinyprogressionscope: definition('DestinyProgressionScope', DestinyProgressionScope),
  stepdisplayeffect: definition('DestinyProgressionStepDisplayEffect', DestinyProgressionStepDisplayEffect),
  progressionstepdisplayeffect: definition(
    'DestinyProgressionStepDisplayEffect',
    DestinyProgressionStepDisplayEffect,
  ),
  displaycategorysortorder: definition('VendorDisplayCategorySortOrder', VendorDisplayCategorySortOrder),
  sortorder: definition('VendorDisplayCategorySortOrder', VendorDisplayCategorySortOrder),
  rewardselection: definition(
    'DestinyVendorInteractionRewardSelection',
    DestinyVendorInteractionRewardSelection,
  ),
  vendorinteractionrewardselection: definition(
    'DestinyVendorInteractionRewardSelection',
    DestinyVendorInteractionRewardSelection,
  ),
  replytype: definition('DestinyVendorReplyType', DestinyVendorReplyType),
  vendorreplytype: definition('DestinyVendorReplyType', DestinyVendorReplyType),
  visibility: definition('DestinySocketVisibility', DestinySocketVisibility),
  socketvisibility: definition('DestinySocketVisibility', DestinySocketVisibility),
  grantstyle: definition('DestinyObjectiveGrantStyle', DestinyObjectiveGrantStyle),
  objectivegrantstyle: definition('DestinyObjectiveGrantStyle', DestinyObjectiveGrantStyle),
  objectiveuistyle: definition('DestinyObjectiveUiStyle', DestinyObjectiveUiStyle),
  aggregationtype: definition('DestinyStatAggregationType', DestinyStatAggregationType),
  refundpolicy: definition('DestinyVendorItemRefundPolicy', DestinyVendorItemRefundPolicy),
  vendoritemrefundpolicy: definition('DestinyVendorItemRefundPolicy', DestinyVendorItemRefundPolicy),
  racetype: definition('DestinyRace', DestinyRace),
  destinyrace: definition('DestinyRace', DestinyRace),
  gendertype: definition('DestinyGender', DestinyGender),
  destinygender: definition('DestinyGender', DestinyGender),
  membershiptype: definition('BungieMembershipType', BungieMembershipType),
  bungiemembershiptype: definition('BungieMembershipType', BungieMembershipType),
  attributes: definition('EquippingItemBlockAttributes', EquippingItemBlockAttributes, true),
  plugavailability: definition('PlugAvailabilityMode', PlugAvailabilityMode),
  recordstate: definition('DestinyRecordState', DestinyRecordState, true),
  collectiblestate: definition('DestinyCollectibleState', DestinyCollectibleState, true),
  itemsorttype: definition('DestinyItemSortType', DestinyItemSortType),
  navpointtype: definition('DestinyActivityNavPointType', DestinyActivityNavPointType),
  activitynavpointtype: definition('DestinyActivityNavPointType', DestinyActivityNavPointType),
  rewardsourcecategory: definition('DestinyRewardSourceCategory', DestinyRewardSourceCategory),
  graphnodestate: definition('DestinyGraphNodeState', DestinyGraphNodeState),
  nodestate: definition('DestinyGraphNodeState', DestinyGraphNodeState),
  rewarditemacquisitionbehavior: definition(
    'DestinyProgressionRewardItemAcquisitionBehavior',
    DestinyProgressionRewardItemAcquisitionBehavior,
  ),
  acquisitionbehavior: definition(
    'DestinyProgressionRewardItemAcquisitionBehavior',
    DestinyProgressionRewardItemAcquisitionBehavior,
  ),
  unlockstatus: definition('DestinyUnlockStatus', DestinyUnlockStatus),
  equipfailurereason: definition('EquipFailureReason', EquipFailureReason, true),
  equipfailurereasons: definition('EquipFailureReason', EquipFailureReason, true),
  joinclosedreasons: definition('DestinyJoinClosedReasons', DestinyJoinClosedReasons, true),
  vendorfilter: definition('DestinyVendorFilter', DestinyVendorFilter),
  weaponperformances: definition(
    'DestinyTalentNodeStepWeaponPerformances',
    DestinyTalentNodeStepWeaponPerformances,
    true,
  ),
  impacteffects: definition(
    'DestinyTalentNodeStepImpactEffects',
    DestinyTalentNodeStepImpactEffects,
    true,
  ),
  guardianattributes: definition(
    'DestinyTalentNodeStepGuardianAttributes',
    DestinyTalentNodeStepGuardianAttributes,
    true,
  ),
  lightabilities: definition(
    'DestinyTalentNodeStepLightAbilities',
    DestinyTalentNodeStepLightAbilities,
    true,
  ),
  talentnodestepweaponperformances: definition(
    'DestinyTalentNodeStepWeaponPerformances',
    DestinyTalentNodeStepWeaponPerformances,
    true,
  ),
  talentnodestepimpacteffects: definition(
    'DestinyTalentNodeStepImpactEffects',
    DestinyTalentNodeStepImpactEffects,
    true,
  ),
  talentnodestepguardianattributes: definition(
    'DestinyTalentNodeStepGuardianAttributes',
    DestinyTalentNodeStepGuardianAttributes,
    true,
  ),
  talentnodesteplightabilities: definition(
    'DestinyTalentNodeStepLightAbilities',
    DestinyTalentNodeStepLightAbilities,
    true,
  ),
  talentnodestepdamagetypes: definition(
    'DestinyTalentNodeStepDamageTypes',
    DestinyTalentNodeStepDamageTypes,
    true,
  ),
};

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bitmaskLabel(definitionValue: EnumDefinition, value: number): string | null {
  const unsigned = value >>> 0;
  if (unsigned === 0) return definitionValue.values[0] ?? 'None';

  const bits = Object.keys(definitionValue.values)
    .map((key) => Number(key))
    .filter((bit) => Number.isInteger(bit) && bit > 0 && (unsigned & bit) === bit)
    // Match the inspector style shown to users: strongest bits first.
    .sort((a, b) => b - a);

  const labels: string[] = [];
  let consumed = 0;
  let knownBits = 0;
  for (const bit of bits) {
    const label = definitionValue.values[bit];
    if (!label) continue;
    labels.push(label);
    consumed |= bit;
    knownBits += 1;
  }

  if (knownBits === 0) return null;

  const remainder = (unsigned & ~consumed) >>> 0;
  if (remainder !== 0) {
    labels.push(`0x${remainder.toString(16)}`);
  }

  return labels.length > 0 ? labels.join(' | ') : null;
}

function annotate(definitionValue: EnumDefinition, value: number): EnumAnnotation | null {
  if (!Number.isInteger(value)) return null;

  if (definitionValue.isBitmask) {
    const label = bitmaskLabel(definitionValue, value);
    if (!label) return null;
    return { enumName: definitionValue.name, label, isBitmask: true };
  }

  const label = definitionValue.values[value >>> 0];
  if (!label) return null;
  return { enumName: definitionValue.name, label };
}

function resolveContextualField(field: string, parent: string): EnumDefinition | null {
  if (field === 'uistyle' || field === 'uilabelstyle') {
    if (parent.includes('objective')) return definition('DestinyObjectiveUiStyle', DestinyObjectiveUiStyle);
    if (parent.includes('plug') || parent.includes('socket')) {
      return definition('PlugUiStyles', PlugUiStyles, true);
    }
    return null;
  }

  if (field === 'style') {
    if (parent.includes('socketcategory')) {
      return definition('SocketCategoryStyle', SocketCategoryStyle);
    }
    return null;
  }

  if (field === 'state') {
    if (parent.includes('collectible')) {
      return definition('DestinyCollectibleState', DestinyCollectibleState, true);
    }
    if (parent.includes('record')) {
      return definition('DestinyRecordState', DestinyRecordState, true);
    }
    if (parent.includes('graphnode')) {
      return definition('DestinyGraphNodeState', DestinyGraphNodeState);
    }
    return null;
  }

  if (field === 'category') {
    if (parent.includes('bucket')) return definition('BucketCategory', BucketCategory);
    if (parent.includes('rewardsource')) {
      return definition('DestinyRewardSourceCategory', DestinyRewardSourceCategory);
    }
    return null;
  }

  if (field === 'mode') {
    if (parent.includes('activitymode') || parent.includes('activity')) {
      return definition('DestinyActivityModeType', DestinyActivityModeType);
    }
    return null;
  }

  if (field === 'type') {
    if (parent.includes('presentationnode') || parent.includes('presentation')) {
      return definition('DestinyPresentationNodeType', DestinyPresentationNodeType);
    }
    if (parent.includes('activitymode') || parent.includes('mode')) {
      return definition('DestinyActivityModeType', DestinyActivityModeType);
    }
    return null;
  }

  return null;
}

/**
 * Annotate a numeric enum field for the JSON inspector. Returns null when the
 * field is not a known enum or the value is outside the known range.
 */
export function annotateEnumField(
  fieldName: string,
  value: number,
  parentKey?: string,
): EnumAnnotation | null {
  const field = normalizeKey(fieldName);
  if (!field || field === 'hash' || field.endsWith('hash')) return null;

  const parent = parentKey ? normalizeKey(parentKey) : '';

  if (parent) {
    const contextual = resolveContextualField(field, parent);
    if (contextual) return annotate(contextual, value);
  }

  const direct = ANNOTATION_FIELDS[field];
  if (!direct) return null;
  return annotate(direct, value);
}

/* -------------------------------------------------------------------------- */
/* Filter option catalogs                                                     */
/* -------------------------------------------------------------------------- */

export const TIER_FILTER_OPTIONS: FilterOption[] = [
  { value: 6, label: 'Exotic' },
  { value: 5, label: 'Legendary' },
  { value: 4, label: 'Rare' },
  { value: 3, label: 'Uncommon' },
  { value: 2, label: 'Common' },
];

export const DAMAGE_FILTER_OPTIONS: FilterOption[] = [
  { value: 1, label: 'Kinetic' },
  { value: 2, label: 'Arc' },
  { value: 3, label: 'Solar' },
  { value: 4, label: 'Void' },
  { value: 6, label: 'Stasis' },
  { value: 7, label: 'Strand' },
];

export const CLASS_FILTER_OPTIONS: FilterOption[] = [
  { value: 0, label: 'Titan' },
  { value: 1, label: 'Hunter' },
  { value: 2, label: 'Warlock' },
];

/**
 * Item type filter values. Most map to DestinyItemType, with Shader expressed
 * as the item sub-type because shaders share the Mod item type in the manifest.
 */
export const ITEM_TYPE_FILTER_OPTIONS: FilterOption[] = [
  { value: 3, label: 'Weapon' },
  { value: 2, label: 'Armor' },
  { value: 19, label: 'Mod' },
  { value: 20, label: 'Shader' },
  { value: 14, label: 'Emblem' },
  { value: 15, label: 'Quest' },
  { value: 16, label: 'Subclass' },
  { value: 24, label: 'Ghost' },
  { value: 21, label: 'Ship' },
  { value: 22, label: 'Sparrow' },
  { value: 9, label: 'Consumable' },
  { value: 8, label: 'Engram' },
  { value: 26, label: 'Bounty' },
  { value: 23, label: 'Emote' },
  { value: 29, label: 'Finisher' },
  { value: 30, label: 'Pattern' },
];
