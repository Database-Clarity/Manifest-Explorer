import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const DIFF_BUCKET_STORAGE_KEY = 'clarity-manifest-diff-bucket';
export const DIFF_BUCKET_BULK_CAP = 100;

export interface DiffBucketItem {
  key: string;
  table: string;
  hash: number;
  name: string;
  subtitle: string;
  icon?: string;
  addedAt: number;
}

export type NewDiffBucketItem = Omit<DiffBucketItem, 'key' | 'addedAt'> & {
  key?: string;
  addedAt?: number;
};

export interface DiffBucketState {
  items: DiffBucketItem[];
  baseKey: string | null;
  targetKey: string | null;
  diffTabOpen: boolean;
  diffTabActive: boolean;
  addItem: (
    item: NewDiffBucketItem,
    opts?: { openTab?: boolean; focusTab?: boolean },
  ) => void;
  addItems: (
    items: readonly NewDiffBucketItem[],
    opts?: { openTab?: boolean; focusTab?: boolean; cap?: number },
  ) => { addedCount: number; totalCount: number; truncated: boolean };
  removeItem: (key: string) => void;
  clearAll: () => void;
  setBase: (key: string | null) => void;
  setTarget: (key: string | null) => void;
  swapBaseTarget: () => void;
  openDiffTab: (focus?: boolean) => void;
  closeDiffTab: () => void;
  focusDiffTab: () => void;
  blurDiffTab: () => void;
  openPairInDiff: (baseItem: NewDiffBucketItem, targetItem: NewDiffBucketItem) => void;
  hasItem: (table: string, hash: number) => boolean;
}

export function diffBucketKey(table: string, hash: number): string {
  return `${table}:${hash >>> 0}`;
}

function normalizeItem(item: NewDiffBucketItem): DiffBucketItem {
  const hash = item.hash >>> 0;
  return {
    key: diffBucketKey(item.table, hash),
    table: item.table,
    hash,
    name: item.name ?? '',
    subtitle: item.subtitle ?? '',
    ...(item.icon ? { icon: item.icon } : {}),
    addedAt: item.addedAt ?? Date.now(),
  };
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

const diffBucketStorage = createJSONStorage<Pick<
  DiffBucketState,
  'items' | 'baseKey' | 'targetKey' | 'diffTabOpen'
>>(() => {
  const storage = safeLocalStorage();
  if (storage) return storage;
  return {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
});

function bucketItems(value: unknown): DiffBucketItem[] {
  if (!Array.isArray(value)) return [];
  const items: DiffBucketItem[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      typeof (candidate as DiffBucketItem).table !== 'string' ||
      typeof (candidate as DiffBucketItem).hash !== 'number'
    ) {
      continue;
    }
    const raw = candidate as DiffBucketItem;
    const item = normalizeItem(raw);
    if (keys.has(item.key)) continue;
    keys.add(item.key);
    items.push(item);
  }
  return items;
}

export const useDiffBucketStore = create<DiffBucketState>()(
  persist(
    (set, get) => ({
      items: [],
      baseKey: null,
      targetKey: null,
      diffTabOpen: false,
      diffTabActive: false,

      addItem: (input, opts) =>
        set((state) => {
          const item = normalizeItem(input);
          const exists = state.items.some((entry) => entry.key === item.key);
          const items = exists ? state.items : [...state.items, item];
          const baseKey =
            !exists && state.baseKey === null
              ? item.key
              : state.baseKey;
          const targetKey =
            !exists &&
            baseKey !== null &&
            state.targetKey === null &&
            item.key !== baseKey
              ? item.key
              : state.targetKey;
          return {
            items,
            baseKey,
            targetKey,
            ...(opts?.openTab
              ? {
                  diffTabOpen: true,
                  diffTabActive: opts.focusTab ?? false,
                }
              : {}),
          };
        }),

      addItems: (inputs, opts) => {
        const cap = Math.max(
          0,
          Number.isFinite(opts?.cap) ? Math.floor(opts?.cap ?? DIFF_BUCKET_BULK_CAP) : DIFF_BUCKET_BULK_CAP,
        );
        let addedCount = 0;
        const inputItems = inputs.map(normalizeItem);
        const initialKeys = new Set(get().items.map((item) => item.key));
        const uniqueNewItems: DiffBucketItem[] = [];
        const seenInputKeys = new Set<string>();
        for (const item of inputItems) {
          if (initialKeys.has(item.key) || seenInputKeys.has(item.key)) continue;
          seenInputKeys.add(item.key);
          uniqueNewItems.push(item);
        }
        set((state) => {
          const items = [...state.items];
          const keys = new Set(items.map((item) => item.key));
          let baseKey = state.baseKey;
          let targetKey = state.targetKey;
          for (const item of uniqueNewItems) {
            if (keys.has(item.key) || addedCount >= cap) continue;
            keys.add(item.key);
            items.push(item);
            addedCount += 1;
            if (baseKey === null) baseKey = item.key;
            else if (targetKey === null && item.key !== baseKey) targetKey = item.key;
          }
          return {
            items,
            baseKey,
            targetKey,
            ...(opts?.openTab
              ? { diffTabOpen: true, diffTabActive: opts.focusTab ?? false }
              : {}),
          };
        });
        const totalCount = get().items.length;
        return {
          addedCount,
          totalCount,
          truncated: uniqueNewItems.length > addedCount,
        };
      },

      removeItem: (key) =>
        set((state) => {
          const items = state.items.filter((item) => item.key !== key);
          let baseKey = state.baseKey;
          let targetKey = state.targetKey;

          if (state.baseKey === key) {
            // Base removed. When exactly one item remains and it was the
            // target, promote it to base and clear the target so the 1-item
            // state reads as Base and the next added item auto-fills Target.
            if (items.length === 1 && items[0]?.key === state.targetKey) {
              baseKey = items[0].key;
              targetKey = null;
            } else {
              baseKey = items.find((item) => item.key !== state.targetKey)?.key ?? null;
            }
          }
          if (state.targetKey === key) {
            targetKey = items.find((item) => item.key !== baseKey)?.key ?? null;
          }
          return { items, baseKey, targetKey };
        }),

      clearAll: () => set({ items: [], baseKey: null, targetKey: null }),

      setBase: (key) =>
        set((state) => ({
          baseKey: key !== null && state.items.some((item) => item.key === key) ? key : null,
        })),

      setTarget: (key) =>
        set((state) => ({
          targetKey: key !== null && state.items.some((item) => item.key === key) ? key : null,
        })),

      swapBaseTarget: () =>
        set((state) => ({ baseKey: state.targetKey, targetKey: state.baseKey })),

      openDiffTab: (focus = true) =>
        set((state) => ({
          diffTabOpen: true,
          diffTabActive: focus ? true : state.diffTabActive,
        })),

      closeDiffTab: () => set({ diffTabOpen: false, diffTabActive: false }),
      focusDiffTab: () => set({ diffTabOpen: true, diffTabActive: true }),
      blurDiffTab: () => set({ diffTabActive: false }),

      openPairInDiff: (baseInput, targetInput) =>
        set((state) => {
          const base = normalizeItem(baseInput);
          const target = normalizeItem(targetInput);
          const items = [...state.items];
          const keys = new Set(items.map((item) => item.key));
          if (!keys.has(base.key)) items.push(base);
          if (target.key !== base.key && !keys.has(target.key)) items.push(target);
          return {
            items,
            baseKey: base.key,
            targetKey: target.key,
            diffTabOpen: true,
            diffTabActive: true,
          };
        }),

      hasItem: (table, hash) =>
        get().items.some((item) => item.key === diffBucketKey(table, hash)),
    }),
    {
      name: DIFF_BUCKET_STORAGE_KEY,
      version: 1,
      storage: diffBucketStorage,
      partialize: (state) => ({
        items: state.items,
        baseKey: state.baseKey,
        targetKey: state.targetKey,
        diffTabOpen: state.diffTabOpen,
      }),
      merge: (persisted, current) => {
        const value =
          typeof persisted === 'object' && persisted !== null
            ? (persisted as Record<string, unknown>)
            : {};
        const items = bucketItems(value.items);
        const validKeys = new Set(items.map((item) => item.key));
        const nextBaseKey =
          typeof value.baseKey === 'string' && validKeys.has(value.baseKey)
            ? value.baseKey
            : items[0]?.key ?? null;
        return {
          ...current,
          items,
          baseKey: nextBaseKey,
          targetKey:
            typeof value.targetKey === 'string' && validKeys.has(value.targetKey)
              ? value.targetKey
              : items.find((item) => item.key !== nextBaseKey)?.key ?? null,
          diffTabOpen: value.diffTabOpen === true,
          diffTabActive: value.diffTabOpen === true,
        };
      },
    },
  ),
);
