import { describe, expect, it } from 'vitest';
import {
  formatBucketDiffLabel,
  formatBucketEntryCount,
  isBucketExpanded,
} from '../historyBuckets';

describe('history bucket summaries', () => {
  it('formats entry totals with correct singular and plural grammar', () => {
    expect(formatBucketEntryCount(1)).toBe('1 entry');
    expect(formatBucketEntryCount(42)).toBe('42 entries');
    expect(formatBucketEntryCount(1240)).toBe('1,240 entries');
  });

  it('formats every change kind as a readable, localized diff label', () => {
    expect(formatBucketDiffLabel('a', 1240)).toBe('+1,240 added');
    expect(formatBucketDiffLabel('m', 5)).toBe('~5 modified');
    expect(formatBucketDiffLabel('r', 3)).toBe('−3 removed');
    expect(formatBucketDiffLabel('u', 2)).toBe('2 unclassified');
    expect(formatBucketDiffLabel('c', 4)).toBe('4 reclassified');
  });

  it('defaults to collapsed and lets explicit bucket choices override search expansion', () => {
    expect(isBucketExpanded('items', {}, false)).toBe(false);
    expect(isBucketExpanded('items', {}, true)).toBe(true);
    expect(isBucketExpanded('items', { items: false }, true)).toBe(false);
    expect(isBucketExpanded('items', { items: true }, false)).toBe(true);
  });
});
