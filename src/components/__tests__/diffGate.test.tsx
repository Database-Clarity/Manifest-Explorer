/** @vitest-environment jsdom */
import { vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
  });
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultsPane, resetSavedResultsScroll } from '../ResultsPane';
import { DefinitionInspector } from '../inspector/DefinitionInspector';
import { createDefaultFilters, useExplorerStore } from '../../stores/explorer';
import { useSettingsStore } from '../../stores/settings';
import { useDiffBucketStore, diffBucketKey } from '../../stores/diffBucket';
import type { DefinitionDetailPayload, SearchResultGroup, SearchResultItem } from '../../types/manifest';

const items: SearchResultItem[] = [
  {
    hash: 101,
    table: 'DestinyInventoryItemDefinition',
    name: 'Dreambane Helm',
    subtitle: 'Legendary Helmet',
  },
  {
    hash: 102,
    table: 'DestinyInventoryItemDefinition',
    name: 'Dreambane Gauntlets',
    subtitle: 'Legendary Gauntlets',
  },
  {
    hash: 103,
    table: 'DestinyInventoryItemDefinition',
    name: 'Dreambane Plate',
    subtitle: 'Legendary Chest Armor',
  },
];

const groups: SearchResultGroup[] = [
  {
    key: 'DestinyInventoryItemDefinition',
    label: 'Inventory Item',
    count: items.length,
    loaded: items.length,
  },
];

const detail: DefinitionDetailPayload = {
  table: 'DestinyInventoryItemDefinition',
  hash: 101,
  data: {
    displayProperties: { name: 'Dreambane Helm' },
    itemTypeDisplayName: 'Legendary Helmet',
  },
  coTables: [],
  resolvedRefs: {},
};

const currentRef = {
  table: 'DestinyInventoryItemDefinition',
  hash: 101,
  label: 'Dreambane Helm',
};

let roots: Root[] = [];

function render(node: ReactNode): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

function renderResultsPane(): HTMLDivElement {
  return render(
    <ResultsPane
      onOpenItem={() => {}}
      onRetryBoot={() => {}}
      onLoadMore={() => {}}
      onLoadAll={() => {}}
      loadMoreStep={100}
      loadingMore={false}
    />,
  );
}

function renderInspector(): HTMLDivElement {
  return render(
    <DefinitionInspector
      width={420}
      onResize={() => {}}
      currentRef={currentRef}
      detail={detail}
      loading={false}
      loadingFull={false}
      error={null}
      variants={[]}
      variantsLoading={false}
      references={null}
      referencesLoading={false}
      baseDetail={null}
      targetDetail={null}
      baseLoading={false}
      targetLoading={false}
      clarityEntry={null}
      clarityLoading={false}
      showClarity={false}
      onNavigateRef={() => {}}
      onNavigateBack={() => {}}
      onNavigateForward={() => {}}
      onJumpToHistoryIndex={() => {}}
      onSwitchSession={() => {}}
      onLoadFullItem={() => {}}
      onLoadPriorityTable={() => {}}
      onRetry={() => {}}
    />,
  );
}

function rowDiffButtons(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button[class*="diffAction"]'));
}

function entityDiffButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[class*="diffEntityButton"]');
}

function bulkDiffButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    'button[aria-label$="loaded results to Diff bucket"]',
  );
}

function openDiffShortcutButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[aria-label^="Open Diff tab"]');
}

beforeEach(() => {
  resetSavedResultsScroll();
  useExplorerStore.setState({
    query: 'dreambane',
    deepSearch: false,
    filters: createDefaultFilters(),
    results: items,
    totalMatches: items.length,
    searchDurationMs: 0,
    searching: false,
    selectedResultIndex: 0,
    resultGroups: groups,
    collapsedResultGroups: {},
    versionDates: [],
    entryDatesStatus: 'idle',
    sessions: [],
    activeSessionIndex: -1,
    history: [],
    historyIndex: -1,
    mobileInspectorOpen: false,
    activeTab: 'pretty',
  });
  useSettingsStore.setState({
    groupBy: 'none',
    viewMode: 'list',
    sortMode: 'relevance',
  });
  useDiffBucketStore.setState({
    items: [],
    baseKey: null,
    targetKey: null,
    diffTabOpen: false,
    diffTabActive: false,
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  resetSavedResultsScroll();
});

describe('Diff controls stay behind the Diff tab gate', () => {
  it('renders only the Open Diff shortcut (no per-row or bulk add controls) while Diff tab is closed', () => {
    const host = renderResultsPane();

    expect(rowDiffButtons(host)).toHaveLength(0);
    expect(bulkDiffButton(host)).toBeNull();
    const shortcut = openDiffShortcutButton(host);
    expect(shortcut).not.toBeNull();

    act(() => shortcut?.click());
    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    expect(openDiffShortcutButton(host)).toBeNull();
    expect(bulkDiffButton(host)).not.toBeNull();
    expect(rowDiffButtons(host)).toHaveLength(items.length);
  });

  it('unlocks per-row and bulk Diff controls without leaving the results list', () => {
    useDiffBucketStore.setState({ diffTabOpen: true, diffTabActive: true });
    useExplorerStore.setState({ mobileInspectorOpen: false });
    const host = renderResultsPane();

    const rowButtons = rowDiffButtons(host);
    expect(rowButtons.length).toBe(items.length);
    expect(bulkDiffButton(host)).not.toBeNull();

    act(() => rowButtons[0]?.click());

    expect(useDiffBucketStore.getState().items.map((item) => item.key)).toEqual([
      diffBucketKey(items[0]!.table, items[0]!.hash),
    ]);
    // Tapping a row's Diff button must not yank the user to the Diff screen.
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(false);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    expect(rowDiffButtons(host)).toHaveLength(items.length);
    expect(
      host.querySelector(`button[aria-label="Remove ${items[0]!.name} from Diff bucket"]`),
    ).not.toBeNull();

    act(() => bulkDiffButton(host)?.click());
    expect(useDiffBucketStore.getState().items).toHaveLength(items.length);
  });

  it('closing the Diff tab hides every ResultsPane Diff control while keeping bucket items', () => {
    useDiffBucketStore.setState({
      diffTabOpen: true,
      diffTabActive: true,
      items: items.map((item) => ({
        key: diffBucketKey(item.table, item.hash),
        table: item.table,
        hash: item.hash,
        name: item.name,
        subtitle: item.subtitle,
        addedAt: 1,
      })),
    });
    const host = renderResultsPane();
    expect(rowDiffButtons(host).length).toBeGreaterThan(0);
    expect(bulkDiffButton(host)).not.toBeNull();

    act(() => useDiffBucketStore.getState().closeDiffTab());

    expect(rowDiffButtons(host)).toHaveLength(0);
    expect(bulkDiffButton(host)).toBeNull();
    expect(openDiffShortcutButton(host)?.getAttribute('aria-label')).toBe(
      `Open Diff tab (${items.length} in bucket)`,
    );
    expect(useDiffBucketStore.getState().items).toHaveLength(items.length);
  });

  it('gates the entity-header Diff toggle without stealing focus from the inspected entry', () => {
    const host = renderInspector();
    expect(entityDiffButton(host)).toBeNull();

    act(() => useDiffBucketStore.getState().openDiffTab(false));
    const toggle = entityDiffButton(host);
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('aria-label')).toBe('Add to Diff bucket');

    act(() => toggle?.click());

    expect(useDiffBucketStore.getState().items.map((item) => item.key)).toEqual([
      diffBucketKey(currentRef.table, currentRef.hash),
    ]);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(false);
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(false);
    expect(
      host.querySelector('button[aria-label="Remove from Diff bucket"]'),
    ).not.toBeNull();

    expect(entityDiffButton(host)?.getAttribute('aria-label')).toBe(
      'Remove from Diff bucket',
    );

    act(() => useDiffBucketStore.getState().closeDiffTab());
    expect(entityDiffButton(host)).toBeNull();
    expect(useDiffBucketStore.getState().items).toHaveLength(1);
  });
});
