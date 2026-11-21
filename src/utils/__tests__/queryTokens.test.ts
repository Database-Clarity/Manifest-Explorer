import { describe, expect, it } from 'vitest';
import {
  clearQueryFilterTokens,
  countQueryFilterTokens,
  filterGroupIdForToken,
  hasQueryToken,
  toggleQueryToken,
  toggleQueryTokenInGroup,
} from '../queryTokens';

const damage = (query: string, token: string): string =>
  toggleQueryTokenInGroup(query, token, 'damage');
const tier = (query: string, token: string): string =>
  toggleQueryTokenInGroup(query, token, 'tier');
const category = (query: string, token: string): string =>
  toggleQueryTokenInGroup(query, token, 'category');

describe('toggleQueryTokenInGroup — adding chips', () => {
  it('writes a bare token for the first chip in a category', () => {
    expect(damage('', 'damage:solar')).toBe('damage:solar');
    expect(damage('tier:exotic', 'damage:solar')).toBe('tier:exotic damage:solar');
  });

  it('replaces a lone category token with a parenthesized OR group', () => {
    expect(damage('damage:solar', 'damage:arc')).toBe('(damage:solar or damage:arc)');
    expect(damage('tier:exotic damage:solar', 'damage:arc')).toBe(
      'tier:exotic (damage:solar or damage:arc)',
    );
  });

  it('extends an existing OR group with a third chip', () => {
    expect(damage('(damage:solar or damage:arc)', 'damage:void')).toBe(
      '(damage:solar or damage:arc or damage:void)',
    );
    expect(damage('tier:exotic (damage:solar or damage:arc)', 'damage:void')).toBe(
      'tier:exotic (damage:solar or damage:arc or damage:void)',
    );
  });

  it('ANDs other categories alongside the OR group', () => {
    expect(tier('(damage:solar or damage:arc) tier:exotic', 'tier:legendary')).toBe(
      '(damage:solar or damage:arc) (tier:exotic or tier:legendary)',
    );
    expect(toggleQueryTokenInGroup('tier:exotic damage:solar', 'is:enhanced', 'highlights')).toBe(
      'tier:exotic damage:solar is:enhanced',
    );
  });

  it('keeps ammo and slot as separate categories', () => {
    expect(toggleQueryTokenInGroup('ammo:special slot:energy', 'slot:power', 'slot')).toBe(
      'ammo:special (slot:energy or slot:power)',
    );
    expect(toggleQueryTokenInGroup('ammo:special', 'slot:energy', 'slot')).toBe(
      'ammo:special slot:energy',
    );
  });

  it('groups scattered bare tokens from one category without touching other terms', () => {
    expect(damage('damage:solar damage:arc', 'damage:void')).toBe(
      '(damage:solar or damage:arc or damage:void)',
    );
    expect(damage('damage:solar or damage:arc', 'damage:void')).toBe(
      '(damage:solar or damage:arc or damage:void)',
    );
    expect(damage('tier:exotic damage:solar damage:arc', 'damage:void')).toBe(
      'tier:exotic (damage:solar or damage:arc or damage:void)',
    );
  });

  it('joins bare and grouped chips of one category into a single OR group', () => {
    expect(damage('damage:solar (damage:arc or damage:void)', 'damage:stasis')).toBe(
      '(damage:solar or damage:arc or damage:void or damage:stasis)',
    );
  });

  it('does not treat negated category tokens as chips to join', () => {
    expect(damage('-damage:solar tier:exotic', 'damage:arc')).toBe(
      '-damage:solar tier:exotic damage:arc',
    );
  });

  it('reuses a dangling trailing operator inside a group', () => {
    expect(damage('(damage:solar or)', 'damage:arc')).toBe('(damage:solar or damage:arc)');
  });

  it('preserves free text while editing groups', () => {
    expect(damage('Gjallarhorn damage:solar', 'damage:arc')).toBe(
      'Gjallarhorn (damage:solar or damage:arc)',
    );
  });
});

describe('toggleQueryTokenInGroup — removing chips', () => {
  it('removes a standalone token cleanly', () => {
    expect(damage('damage:solar', 'damage:solar')).toBe('');
    expect(damage('tier:exotic damage:solar', 'damage:solar')).toBe('tier:exotic');
  });

  it('unwraps a two-item OR group back to a bare token', () => {
    expect(damage('(damage:solar or damage:arc)', 'damage:arc')).toBe('damage:solar');
    expect(damage('tier:exotic (damage:solar or damage:arc)', 'damage:arc')).toBe(
      'tier:exotic damage:solar',
    );
  });

  it('keeps parentheses when three or more chips remain', () => {
    expect(damage('(damage:solar or damage:arc or damage:void)', 'damage:arc')).toBe(
      '(damage:solar or damage:void)',
    );
  });

  it('removes the whole group with its last chip', () => {
    expect(damage('(damage:solar or damage:arc) tier:exotic', 'damage:arc')).toBe(
      'damage:solar tier:exotic',
    );
    expect(damage('damage:solar tier:exotic', 'damage:solar')).toBe('tier:exotic');
  });

  it('removes every duplicate occurrence', () => {
    expect(damage('damage:solar (damage:solar or damage:arc)', 'damage:solar')).toBe('damage:arc');
  });

  it('drops a dangling operator when the first chip is removed', () => {
    expect(damage('damage:solar or tier:exotic', 'damage:solar')).toBe('tier:exotic');
    expect(damage('tier:exotic and damage:solar', 'damage:solar')).toBe('tier:exotic');
  });

  it('treats a negated token as off and adds a positive copy', () => {
    expect(damage('not damage:solar tier:exotic', 'damage:solar')).toBe(
      'not damage:solar tier:exotic damage:solar',
    );
  });

  it('leaves other categories and their groups untouched', () => {
    expect(
      damage('(tier:exotic or tier:legendary) damage:solar', 'damage:solar'),
    ).toBe('(tier:exotic or tier:legendary)');
  });
});

describe('quoted category tokens', () => {
  it('adds and ORs quoted values', () => {
    expect(category('', 'cat:"Hand Cannon"')).toBe('cat:"Hand Cannon"');
    expect(category('cat:"Hand Cannon"', 'cat:"Pulse Rifle"')).toBe(
      '(cat:"Hand Cannon" or cat:"Pulse Rifle")',
    );
    expect(category('(cat:"Hand Cannon" or cat:"Pulse Rifle")', 'cat:"Auto Rifle"')).toBe(
      '(cat:"Hand Cannon" or cat:"Pulse Rifle" or cat:"Auto Rifle")',
    );
  });

  it('unwraps a quoted pair back to one token', () => {
    expect(category('(cat:"Hand Cannon" or cat:"Pulse Rifle")', 'cat:"Pulse Rifle"')).toBe(
      'cat:"Hand Cannon"',
    );
  });
});

describe('full chip lifecycle', () => {
  it('builds up and tears down a mixed-category query', () => {
    let query = '';
    query = damage(query, 'damage:solar');
    expect(query).toBe('damage:solar');
    query = damage(query, 'damage:arc');
    expect(query).toBe('(damage:solar or damage:arc)');
    query = damage(query, 'damage:void');
    expect(query).toBe('(damage:solar or damage:arc or damage:void)');
    query = tier(query, 'tier:exotic');
    expect(query).toBe('(damage:solar or damage:arc or damage:void) tier:exotic');
    query = toggleQueryTokenInGroup(query, 'is:enhanced', 'highlights');
    expect(query).toBe('(damage:solar or damage:arc or damage:void) tier:exotic is:enhanced');
    query = damage(query, 'damage:arc');
    expect(query).toBe('(damage:solar or damage:void) tier:exotic is:enhanced');
    query = damage(query, 'damage:void');
    expect(query).toBe('damage:solar tier:exotic is:enhanced');
    query = damage(query, 'damage:solar');
    expect(query).toBe('tier:exotic is:enhanced');
  });
});

describe('hasQueryToken', () => {
  it('recognizes tokens inside parentheses', () => {
    expect(hasQueryToken('(damage:solar or damage:arc) tier:exotic', 'damage:solar')).toBe(true);
    expect(hasQueryToken('(cat:"Hand Cannon" or cat:Weapon)', 'cat:"Hand Cannon"')).toBe(true);
  });

  it('matches case- and quote-insensitively', () => {
    expect(hasQueryToken('Damage:Solar', 'damage:solar')).toBe(true);
    expect(hasQueryToken('cat:Weapon', 'cat:"Weapon"')).toBe(true);
  });

  it('ignores negated tokens', () => {
    expect(hasQueryToken('-damage:solar', 'damage:solar')).toBe(false);
    expect(hasQueryToken('not damage:solar', 'damage:solar')).toBe(false);
    expect(hasQueryToken('-(damage:solar or damage:arc)', 'damage:solar')).toBe(false);
    expect(hasQueryToken('not (damage:solar or damage:arc)', 'damage:solar')).toBe(false);
    expect(hasQueryToken('-tier:exotic damage:solar', 'tier:exotic')).toBe(false);
  });

  it('still sees a positive copy next to a negated one', () => {
    expect(hasQueryToken('-damage:solar damage:solar', 'damage:solar')).toBe(true);
  });
});

describe('countQueryFilterTokens', () => {
  it('counts filters inside parentheses without counting operators', () => {
    expect(countQueryFilterTokens('(damage:solar or damage:arc) tier:exotic')).toBe(3);
    expect(countQueryFilterTokens('(cat:"Hand Cannon" or cat:Weapon)')).toBe(2);
    expect(countQueryFilterTokens('or and not')).toBe(0);
    expect(countQueryFilterTokens('')).toBe(0);
  });

  it('counts negated filters as structured tokens', () => {
    expect(countQueryFilterTokens('not is:ornament')).toBe(1);
    expect(countQueryFilterTokens('-source:eververse')).toBe(1);
    expect(countQueryFilterTokens('-(tier:common or tier:uncommon)')).toBe(2);
  });

  it('leaves free text and hashes out of the count', () => {
    expect(countQueryFilterTokens('Gjallarhorn tier:exotic')).toBe(1);
    expect(countQueryFilterTokens('deep:wolfpack 1363886209')).toBe(0);
    expect(countQueryFilterTokens('hash:123 Gjallarhorn')).toBe(0);
  });
});

describe('clearQueryFilterTokens', () => {
  it('strips filters, parens, and operators but keeps free text', () => {
    expect(clearQueryFilterTokens('Gjallarhorn (damage:solar or damage:arc) tier:exotic')).toBe(
      'Gjallarhorn',
    );
    expect(clearQueryFilterTokens('deep:wolfpack -engram tier:exotic damage:solar')).toBe(
      'deep:wolfpack -engram',
    );
    expect(clearQueryFilterTokens('hash:123 Gjallarhorn')).toBe('hash:123 Gjallarhorn');
  });

  it('removes negated filters and their groups', () => {
    expect(clearQueryFilterTokens('-(tier:common or tier:uncommon) Gjallarhorn')).toBe(
      'Gjallarhorn',
    );
    expect(clearQueryFilterTokens('not is:ornament Gjallarhorn')).toBe('Gjallarhorn');
    expect(clearQueryFilterTokens('-source:eververse Gjallarhorn')).toBe('Gjallarhorn');
  });

  it('keeps or between surviving free-text words', () => {
    expect(clearQueryFilterTokens('gjallarhorn or wolfpack tier:exotic')).toBe(
      'gjallarhorn or wolfpack',
    );
  });

  it('keeps parentheses that still hold free text', () => {
    expect(clearQueryFilterTokens('Gjallarhorn (gjaller or damage:solar)')).toBe(
      'Gjallarhorn (gjaller)',
    );
  });

  it('clears an all-filter query to the empty string', () => {
    expect(clearQueryFilterTokens('(damage:solar or damage:arc) is:enhanced')).toBe('');
  });
});

describe('toggleQueryToken (compat signature)', () => {
  it('infers the category from the token key', () => {
    expect(toggleQueryToken('', 'damage:solar')).toBe('damage:solar');
    expect(toggleQueryToken('is:enhanced', 'is:adept')).toBe('(is:enhanced or is:adept)');
    expect(toggleQueryToken('season:latest', 's:26')).toBe('(season:latest or s:26)');
  });

  it('toggles unstructured keys plainly', () => {
    expect(toggleQueryToken('Gjallarhorn', 'table:perk')).toBe('Gjallarhorn table:perk');
    expect(toggleQueryToken('Gjallarhorn table:perk', 'table:perk')).toBe('Gjallarhorn');
  });

  it('honors an explicit category token list', () => {
    const seasons = ['season:latest', 's:26', 'season:heresy'] as const;
    expect(toggleQueryToken('tier:exotic', 's:26', seasons)).toBe('tier:exotic s:26');
    expect(toggleQueryToken('tier:exotic s:26', 'season:heresy', seasons)).toBe(
      'tier:exotic (s:26 or season:heresy)',
    );
    expect(toggleQueryToken('tier:exotic (s:26 or season:heresy)', 's:26', seasons)).toBe(
      'tier:exotic season:heresy',
    );
  });
});

describe('filterGroupIdForToken', () => {
  it('maps every filter key to its category', () => {
    expect(filterGroupIdForToken('is:enhanced')).toBe('highlights');
    expect(filterGroupIdForToken('has:lore')).toBe('highlights');
    expect(filterGroupIdForToken('tier:exotic')).toBe('tier');
    expect(filterGroupIdForToken('rarity:exotic')).toBe('tier');
    expect(filterGroupIdForToken('damage:solar')).toBe('damage');
    expect(filterGroupIdForToken('element:void')).toBe('damage');
    expect(filterGroupIdForToken('el:arc')).toBe('damage');
    expect(filterGroupIdForToken('dmg:solar')).toBe('damage');
    expect(filterGroupIdForToken('ammo:primary')).toBe('ammo');
    expect(filterGroupIdForToken('slot:energy')).toBe('slot');
    expect(filterGroupIdForToken('class:titan')).toBe('class');
    expect(filterGroupIdForToken('type:weapon')).toBe('type');
    expect(filterGroupIdForToken('subtype:bow')).toBe('subtype');
    expect(filterGroupIdForToken('weapon:handcannon')).toBe('subtype');
    expect(filterGroupIdForToken('season:latest')).toBe('season');
    expect(filterGroupIdForToken('s:26')).toBe('season');
    expect(filterGroupIdForToken('source:raid')).toBe('source');
    expect(filterGroupIdForToken('cat:"Hand Cannon"')).toBe('category');
    expect(filterGroupIdForToken('categories:Weapon')).toBe('category');
  });

  it('returns null for unstructured keys and free text', () => {
    expect(filterGroupIdForToken('table:perk')).toBeNull();
    expect(filterGroupIdForToken('t:perk')).toBeNull();
    expect(filterGroupIdForToken('trait:rapid')).toBeNull();
    expect(filterGroupIdForToken('hash:123')).toBeNull();
    expect(filterGroupIdForToken('Gjallarhorn')).toBeNull();
    expect(filterGroupIdForToken('deep:wolfpack')).toBeNull();
  });
});
