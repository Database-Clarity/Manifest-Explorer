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

const originalMatchMedia = window.matchMedia;

function mockMediaMatches(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  });
}

function restoreMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
}

function rowDiffButtons(host: HTMLElement): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('button[class*="diffAction"]'));
}

function entityDiffButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[class*="diffEntityButton"]');
}

function diffBanner(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[role="status"][class*="diffBanner"]');
}

function bannerButton(host: HTMLElement, label: string | RegExp): HTMLButtonElement | null {
  const banner = diffBanner(host);
  if (!banner) return null;
  return (
    Array.from(banner.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
      const text = button.textContent?.trim() ?? '';
      return typeof label === 'string' ? text === label : label.test(text);
    }) ?? null
  );
}

function bulkDiffButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button[class*="diffBannerAdd"]');
}

function openDiffShortcutButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    'header button[aria-label^="Open Diff tab"]',
  );
}

beforeEach(() => {
  resetSavedResultsScroll();
  for (const notice of useExplorerStore.getState().notices) {
    useExplorerStore.getState().dismissNotice(notice.id);
  }
  useExplorerStore.setState({
    notices: [],
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
  restoreMatchMedia();
});

describe('Diff controls stay behind the Diff tab gate', () => {
  it('renders only the Open Diff shortcut (no per-row or banner controls) while Diff tab is closed', () => {
    const host = renderResultsPane();

    expect(rowDiffButtons(host)).toHaveLength(0);
    expect(bulkDiffButton(host)).toBeNull();
    expect(diffBanner(host)).toBeNull();
    const shortcut = openDiffShortcutButton(host);
    expect(shortcut).not.toBeNull();

    act(() => shortcut?.click());
    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    expect(openDiffShortcutButton(host)).toBeNull();
    expect(diffBanner(host)?.textContent).toContain('Diff bucket (0)');
    expect(diffBanner(host)?.textContent).toContain('+ Add all (3)');
    expect(diffBanner(host)?.textContent).toContain('Done');
    // Desktop keeps the split pane: no mobile-only Compare button.
    expect(bannerButton(host, /Compare|Open Diff/)).toBeNull();
    // Exactly one clear bulk-add control: in the banner, never duplicated in
    // the header.
    expect(
      host.querySelectorAll('button[aria-label$="loaded results to Diff bucket"]'),
    ).toHaveLength(1);
    expect(rowDiffButtons(host)).toHaveLength(items.length);
  });

  it('unlocks per-row and banner Diff controls without leaving the results list', () => {
    useDiffBucketStore.setState({ diffTabOpen: true, diffTabActive: true });
    useExplorerStore.setState({ mobileInspectorOpen: false });
    const host = renderResultsPane();

    const rowButtons = rowDiffButtons(host);
    expect(rowButtons.length).toBe(items.length);
    expect(bulkDiffButton(host)).not.toBeNull();
    expect(diffBanner(host)?.textContent).toContain('Diff bucket (0)');

    act(() => rowButtons[0]?.click());
    act(() => rowButtons[1]?.click());
    act(() => rowButtons[2]?.click());

    expect(useDiffBucketStore.getState().items.map((item) => item.key)).toEqual(
      items.map((item) => diffBucketKey(item.table, item.hash)),
    );
    // Tapping row Diff toggles must not yank the user to the Diff screen.
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(false);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    expect(rowDiffButtons(host)).toHaveLength(items.length);
    expect(
      host.querySelector(`button[aria-label="Remove ${items[0]!.name} from Diff bucket"]`),
    ).not.toBeNull();
    expect(diffBanner(host)?.textContent).toContain('Diff bucket (3)');
    // Rapid taps collapse into one updating toast instead of a stack of cards.
    expect(useExplorerStore.getState().notices).toHaveLength(1);
    expect(useExplorerStore.getState().notices[0]?.id).toBe('diff-bucket');

    act(() => bulkDiffButton(host)?.click());
    expect(useDiffBucketStore.getState().items).toHaveLength(items.length);
  });

  it('closing the Diff tab via Done hides every ResultsPane Diff control while keeping bucket items', () => {
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
    expect(bulkDiffButton(host)?.disabled).toBe(true);
    expect(bulkDiffButton(host)?.textContent?.trim()).toBe('All added');

    act(() => bannerButton(host, 'Done')?.click());

    expect(useDiffBucketStore.getState().diffTabOpen).toBe(false);
    expect(diffBanner(host)).toBeNull();
    expect(rowDiffButtons(host)).toHaveLength(0);
    expect(bulkDiffButton(host)).toBeNull();
    expect(openDiffShortcutButton(host)?.getAttribute('aria-label')).toBe(
      `Open Diff tab (${items.length} in bucket)`,
    );
    expect(useDiffBucketStore.getState().items).toHaveLength(items.length);
  });

  it('on mobile keeps the Results screen and shows a clear banner when the bucket is empty', () => {
    mockMediaMatches(true);
    const host = renderResultsPane();

    act(() => openDiffShortcutButton(host)?.click());

    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(false);
    // Crucially, the user was NOT thrown onto an empty Diff inspector screen.
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(false);

    const banner = diffBanner(host);
    expect(banner?.textContent).toContain('Diff bucket (0)');
    expect(banner?.textContent).toContain('+ Add all (3)');
    expect(banner?.textContent).toContain('Open Diff');
    expect(banner?.textContent).toContain('Done');
    expect(rowDiffButtons(host)).toHaveLength(items.length);
    // No duplicate Diff/Tabs shortcut in the header while the banner offers
    // the labelled Open Diff action.
    expect(openDiffShortcutButton(host)).toBeNull();
    expect(bannerButton(host, /^Tabs/)).toBeNull();
  });

  it('on mobile opens the Diff tab directly when a pair is already in the bucket', () => {
    mockMediaMatches(true);
    useDiffBucketStore.setState({
      items: items.slice(0, 2).map((item) => ({
        key: diffBucketKey(item.table, item.hash),
        table: item.table,
        hash: item.hash,
        name: item.name,
        subtitle: item.subtitle,
        addedAt: 1,
      })),
      baseKey: diffBucketKey(items[0]!.table, items[0]!.hash),
      targetKey: diffBucketKey(items[1]!.table, items[1]!.hash),
    });
    const host = renderResultsPane();

    act(() => openDiffShortcutButton(host)?.click());

    expect(useDiffBucketStore.getState().diffTabOpen).toBe(true);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    // The App swaps ResultsPane for the populated comparison on mobile.
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(true);
  });

  it('on mobile Add all fills the bucket and jumps straight into the comparison', () => {
    mockMediaMatches(true);
    useDiffBucketStore.setState({ diffTabOpen: true, diffTabActive: false });
    useExplorerStore.setState({ mobileInspectorOpen: false });
    const host = renderResultsPane();

    expect(diffBanner(host)?.textContent).toContain('Diff bucket (0)');
    act(() => bulkDiffButton(host)?.click());

    expect(useDiffBucketStore.getState().items).toHaveLength(items.length);
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(true);
    expect(useExplorerStore.getState().notices).toHaveLength(1);
    expect(useExplorerStore.getState().notices[0]?.message).toBe(
      `Added ${items.length} results to Diff bucket`,
    );
  });

  it('on mobile highlights Compare once two bucket items are ready', () => {
    mockMediaMatches(true);
    useDiffBucketStore.setState({
      diffTabOpen: true,
      diffTabActive: false,
      items: items.slice(0, 2).map((item) => ({
        key: diffBucketKey(item.table, item.hash),
        table: item.table,
        hash: item.hash,
        name: item.name,
        subtitle: item.subtitle,
        addedAt: 1,
      })),
    });
    const host = renderResultsPane();

    const compare = bannerButton(host, 'Compare');
    expect(compare).not.toBeNull();
    expect(compare?.className).toContain('diffBannerCompareReady');

    act(() => compare?.click());
    expect(useDiffBucketStore.getState().diffTabActive).toBe(true);
    expect(useExplorerStore.getState().mobileInspectorOpen).toBe(true);
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
