import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export const COLLECTOR_STORAGE_KEY = 'clarity-manifest-collector';

export interface CollectedItem {
  table: string;
  hash: number;
  name: string;
  subtitle: string;
  icon?: string;
  addedAt: number;
}

export type NewCollectedItem = Omit<CollectedItem, 'addedAt'> & { addedAt?: number };

export type CollectorExportFormat = 'json-hashes' | 'ts-const' | 'csv' | 'markdown' | 'grouped-json';

export interface CollectorState {
  collectMode: boolean;
  items: CollectedItem[];
  toggleCollectMode: () => void;
  addItem: (item: NewCollectedItem) => void;
  removeItem: (table: string, hash: number) => void;
  toggleItem: (item: NewCollectedItem) => void;
  hasItem: (table: string, hash: number) => boolean;
  clearAll: () => void;
}

function sameRef(
  item: Pick<CollectedItem, 'table' | 'hash'>,
  table: string,
  hash: number,
): boolean {
  return item.table === table && item.hash === hash;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function markdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function tsString(value: string): string {
  return `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

/**
 * Serializes collected items into one of the export formats offered by the
 * collector drawer. Output is deterministic and preserves insertion order.
 */
export function formatCollectedItems(items: CollectedItem[], format: CollectorExportFormat): string {
  switch (format) {
    case 'json-hashes': {
      return JSON.stringify(
        items.map((item) => ({ table: item.table, hash: item.hash })),
        null,
        2,
      );
    }

    case 'ts-const': {
      if (items.length === 0) {
        return 'export const COLLECTED_ITEMS = [] as const;\n';
      }

      const lines = items.map(
        (item) => `  { table: ${tsString(item.table)}, hash: ${item.hash} },`,
      );
      return `export const COLLECTED_ITEMS = [\n${lines.join('\n')}\n] as const;\n`;
    }

    case 'csv': {
      const header = 'table,hash,name,subtitle';
      const rows = items.map((item) =>
        [item.table, String(item.hash), item.name, item.subtitle].map(csvCell).join(','),
      );
      return [header, ...rows].join('\n');
    }

    case 'markdown': {
      const header = '| Table | Hash | Name | Subtitle |\n| --- | --- | --- | --- |';
      if (items.length === 0) {
        return header;
      }

      const rows = items.map(
        (item) =>
          `| ${markdownCell(item.table)} | ${item.hash} | ${markdownCell(item.name)} | ${markdownCell(item.subtitle)} |`,
      );
      return [header, ...rows].join('\n');
    }

    case 'grouped-json': {
      const grouped: Record<
        string,
        Array<{ hash: number; name: string; subtitle: string; icon?: string; addedAt: number }>
      > = {};

      for (const item of items) {
        const entry = {
          hash: item.hash,
          name: item.name,
          subtitle: item.subtitle,
          icon: item.icon,
          addedAt: item.addedAt,
        };
        const bucket = grouped[item.table];
        if (bucket) {
          bucket.push(entry);
        } else {
          grouped[item.table] = [entry];
        }
      }

      return JSON.stringify(grouped, null, 2);
    }
  }
}

export const useCollectorStore = create<CollectorState>()(
  persist(
    (set, get) => ({
      collectMode: false,
      items: [],

      toggleCollectMode: () => set((state) => ({ collectMode: !state.collectMode })),

      addItem: (item) =>
        set((state) => {
          const existing = state.items.find((entry) => sameRef(entry, item.table, item.hash));
          if (existing) {
            return {
              items: state.items.map((entry) =>
                sameRef(entry, item.table, item.hash)
                  ? {
                      ...entry,
                      ...item,
                      addedAt: entry.addedAt,
                    }
                  : entry,
              ),
            };
          }

          return {
            items: [
              ...state.items,
              {
                ...item,
                addedAt: item.addedAt ?? Date.now(),
              },
            ],
          };
        }),

      removeItem: (table, hash) =>
        set((state) => ({
          items: state.items.filter((entry) => !sameRef(entry, table, hash)),
        })),

      toggleItem: (item) => {
        if (get().hasItem(item.table, item.hash)) {
          get().removeItem(item.table, item.hash);
        } else {
          get().addItem(item);
        }
      },

      hasItem: (table, hash) => get().items.some((entry) => sameRef(entry, table, hash)),

      clearAll: () => set({ items: [] }),
    }),
    {
      name: COLLECTOR_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): Pick<CollectorState, 'collectMode' | 'items'> => ({
        collectMode: state.collectMode,
        items: state.items,
      }),
    },
  ),
);
