/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DIFF_BUCKET_BULK_CAP,
  DIFF_BUCKET_STORAGE_KEY,
  useDiffBucketStore,
  type NewDiffBucketItem,
} from '../diffBucket';

const item = (hash: number, name = `Item ${hash}`): NewDiffBucketItem => ({
  table: 'DestinyInventoryItemDefinition',
  hash,
  name,
  subtitle: 'Weapon',
});

function resetStore(): void {
  useDiffBucketStore.setState({
    items: [],
    baseKey: null,
    targetKey: null,
    diffTabOpen: false,
    diffTabActive: false,
  });
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(DIFF_BUCKET_STORAGE_KEY);
  }
}

beforeEach(resetStore);

describe('Diff bucket store', () => {
  it('adds unique items and automatically fills the first base and target slots', () => {
    const store = useDiffBucketStore.getState();
    store.addItem(item(1));
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:1',
    );
    expect(useDiffBucketStore.getState().targetKey).toBeNull();

    useDiffBucketStore.getState().addItem(item(2));
    useDiffBucketStore.getState().addItem(item(3));
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
    expect(useDiffBucketStore.getState().items.map((entry) => entry.hash)).toEqual([
      1, 2, 3,
    ]);

    useDiffBucketStore.getState().addItem(item(2, 'Duplicate'));
    expect(useDiffBucketStore.getState().items).toHaveLength(3);
    expect(useDiffBucketStore.getState().items[1]?.name).toBe('Item 2');
  });

  it('normalizes hashes to unsigned keys and honors open/focus options', () => {
    useDiffBucketStore.getState().addItem({
      table: 'DestinyInventoryItemDefinition',
      hash: -1,
      name: 'Unsigned',
      subtitle: '',
    });
    expect(useDiffBucketStore.getState().items[0]?.key).toBe(
      'DestinyInventoryItemDefinition:4294967295',
    );

    useDiffBucketStore.getState().addItem(item(2), { openTab: true });
    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(false);
    useDiffBucketStore.getState().openDiffTab();
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
  });

  it('bulk-adds unique entries up to the cap and reports truncation', () => {
    const inputs = Array.from({ length: DIFF_BUCKET_BULK_CAP + 7 }, (_, i) =>
      item(i + 1),
    );
    const result = useDiffBucketStore.getState().addItems(inputs);

    expect(result).toEqual({
      addedCount: DIFF_BUCKET_BULK_CAP,
      totalCount: DIFF_BUCKET_BULK_CAP,
      truncated: true,
    });
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:1',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
  });

  it('fills missing pair slots without changing already assigned selections', () => {
    const state = useDiffBucketStore.getState();
    state.addItem(item(1));
    state.addItem(item(2));
    state.setBase('DestinyInventoryItemDefinition:2');
    state.addItems([item(3), item(4)]);
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
  });

  it('reassigns a removed base or target to the first compatible remaining item', () => {
    const state = useDiffBucketStore.getState();
    state.addItems([item(1), item(2), item(3)]);
    state.removeItem('DestinyInventoryItemDefinition:1');
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:3',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );

    useDiffBucketStore.getState().removeItem('DestinyInventoryItemDefinition:2');
    expect(useDiffBucketStore.getState().targetKey).toBeNull();
  });

  it('validates selections, swaps them, and supports hasItem', () => {
    const state = useDiffBucketStore.getState();
    state.addItems([item(1), item(2)]);
    expect(state.hasItem('DestinyInventoryItemDefinition', 1)).toBe(true);
    state.setBase('missing');
    expect(useDiffBucketStore.getState().baseKey).toBeNull();
    state.setBase('DestinyInventoryItemDefinition:1');
    state.setTarget('DestinyInventoryItemDefinition:2');
    state.swapBaseTarget();
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:1',
    );
  });

  it('clears entries without closing the Diff tab and closes without clearing entries', () => {
    const state = useDiffBucketStore.getState();
    state.addItem(item(1));
    state.openDiffTab();
    state.clearAll();
    expect(useDiffBucketStore.getState().items).toEqual([]);
    expect(useDiffBucketStore.getState().baseKey).toBeNull();
    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);

    useDiffBucketStore.getState().addItem(item(2));
    useDiffBucketStore.getState().closeDiffTab();
    expect(useDiffBucketStore.getState().items).toHaveLength(1);
    expect(useDiffBucketStore.getState().diffTabOpen).toBe(false);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(false);
  });

  it('opens an explicit pair and focuses the Diff tab', () => {
    useDiffBucketStore.getState().openPairInDiff(item(8), item(9));
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:8',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:9',
    );
    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
  });

  it('promotes the sole remaining target to base when the base is removed', () => {
    const state = useDiffBucketStore.getState();
    state.addItems([item(1), item(2)]);
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:1',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );

    state.removeItem('DestinyInventoryItemDefinition:1');
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
    expect(useDiffBucketStore.getState().targetKey).toBeNull();
    expect(useDiffBucketStore.getState().items).toHaveLength(1);

    // The next added item auto-fills the now-empty target slot.
    useDiffBucketStore.getState().addItem(item(3));
    expect(useDiffBucketStore.getState().baseKey).toBe(
      'DestinyInventoryItemDefinition:2',
    );
    expect(useDiffBucketStore.getState().targetKey).toBe(
      'DestinyInventoryItemDefinition:3',
    );
  });

  it('hydration targetKey fallback never collides with baseKey', () => {
    const options = useDiffBucketStore.persist.getOptions();
    const merged = options.merge?.(
      {
        items: [
          {
            key: 'DestinyInventoryItemDefinition:1',
            table: 'DestinyInventoryItemDefinition',
            hash: 1,
            name: 'Item 1',
            subtitle: 'Weapon',
            addedAt: 0,
          },
          {
            key: 'DestinyInventoryItemDefinition:2',
            table: 'DestinyInventoryItemDefinition',
            hash: 2,
            name: 'Item 2',
            subtitle: 'Weapon',
            addedAt: 0,
          },
        ],
        baseKey: 'DestinyInventoryItemDefinition:2',
        targetKey: 'missing-key',
        diffTabOpen: false,
      },
      useDiffBucketStore.getState(),
    );

    expect(merged?.baseKey).toBe('DestinyInventoryItemDefinition:2');
    expect(merged?.targetKey).toBe('DestinyInventoryItemDefinition:1');
    expect(merged?.targetKey).not.toBe(merged?.baseKey);
  });
});
