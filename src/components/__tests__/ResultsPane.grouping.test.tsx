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

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultsPane, resetSavedResultsScroll } from '../ResultsPane';
import { createDefaultFilters, useExplorerStore } from '../../stores/explorer';
import { useSettingsStore } from '../../stores/settings';
import type { SearchResultGroup, SearchResultItem } from '../../types/manifest';

const groups: SearchResultGroup[] = [
  {
    key: 'DestinyInventoryItemDefinition',
    label: 'Inventory Item',
    count: 5,
    loaded: 3,
  },
  {
    key: 'DestinyActivityDefinition',
    label: 'Activity',
    count: 3,
    loaded: 3,
  },
];

const items: SearchResultItem[] = [
  ...Array.from({ length: 3 }, (_, index) => ({
    hash: index + 1,
    table: 'DestinyInventoryItemDefinition',
    name: `Item ${index + 1}`,
    subtitle: 'Weapon',
  })),
  ...Array.from({ length: 3 }, (_, index) => ({
    hash: index + 11,
    table: 'DestinyActivityDefinition',
    name: `Activity ${index + 1}`,
    subtitle: 'Activity',
  })),
];

let roots: Root[] = [];

function renderPane(root: Root): void {
  act(() => {
    root.render(
      <ResultsPane
        onOpenItem={() => {}}
        onRetryBoot={() => {}}
        onLoadMore={() => {}}
        onLoadAll={() => {}}
        loadMoreStep={100}
        loadingMore={false}
      />,
    );
  });
}

function createPaneRoot(host: HTMLElement): Root {
  const root = createRoot(host);
  roots.push(root);
  return root;
}

function unmountRoot(root: Root): void {
  act(() => root.unmount());
  roots = roots.filter((candidate) => candidate !== root);
}

function getScroller(host: HTMLElement): HTMLElement {
  const scroller = host.querySelector<HTMLElement>('div[aria-label="Search results"]');
  if (!scroller) throw new Error('Results scroller was not rendered');
  return scroller;
}

function dispatchScroll(scroller: HTMLElement, top: number): void {
  scroller.scrollTop = top;
  act(() => {
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

function setViewport(scroller: HTMLElement, width: number, height: number): void {
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: height });
  act(() => window.dispatchEvent(new Event('resize')));
}

beforeEach(() => {
  resetSavedResultsScroll();
  useExplorerStore.setState({
    query: 'weapon',
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
  });
  useSettingsStore.setState({
    groupBy: 'none',
    viewMode: 'list',
    sortMode: 'relevance',
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: undefined,
  });
  roots = [];
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of [...roots]) {
    unmountRoot(root);
  }
  resetSavedResultsScroll();
});

describe('ResultsPane table grouping', () => {
  it('renders the six-field Sort select and uses a joined direction toggle', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);

    const sortSelect = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!sortSelect) throw new Error('Sort select was not rendered');
    expect(host.querySelector('[aria-label^="Sort order:"]')).toBeNull();

    act(() => sortSelect.click());
    const listbox = document.querySelector('[role="listbox"][aria-label="Sort results"]');
    expect(
      [...(listbox?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Relevance', 'Name', 'Hash', 'Index', 'Released', 'Updated']);
    expect(listbox?.textContent).toContain('General');
    expect(listbox?.textContent).toContain('Dates');

    const selectField = (field: string): void => {
      if (!sortSelect.getAttribute('aria-expanded')?.includes('true')) {
        act(() => sortSelect.click());
      }
      const option = document.querySelector<HTMLElement>(
        `[role="listbox"] [data-value="${field}"]`,
      );
      if (!option) throw new Error(`Sort field "${field}" was not rendered`);
      act(() => option.click());
    };

    selectField('release');
    expect(useSettingsStore.getState().sortMode).toBe('release-desc');
    let directionButton = host.querySelector<HTMLButtonElement>('[aria-label^="Sort order:"]');
    expect(directionButton?.getAttribute('aria-label')).toBe(
      'Sort order: newest release first — click to reverse',
    );
    expect(directionButton?.querySelector('svg path')?.getAttribute('d')).toBe(
      'M8 3.5v9M3.5 9 8 13l4.5-4',
    );

    act(() => directionButton?.click());
    expect(useSettingsStore.getState().sortMode).toBe('release-asc');
    directionButton = host.querySelector<HTMLButtonElement>('[aria-label^="Sort order:"]');
    expect(directionButton?.getAttribute('aria-label')).toBe(
      'Sort order: oldest release first — click to reverse',
    );
    expect(directionButton?.querySelector('svg path')?.getAttribute('d')).toBe(
      'M8 12.5v-9M3.5 7 8 3l4.5 4',
    );

    for (const [field, expectedMode] of [
      ['name', 'name-asc'],
      ['hash', 'hash-asc'],
      ['index', 'index-desc'],
      ['update', 'update-desc'],
    ] as const) {
      selectField(field);
      expect(useSettingsStore.getState().sortMode).toBe(expectedMode);
      expect(host.querySelector('[aria-label^="Sort order:"]')).not.toBeNull();
    }
    host.remove();
  });

  it('disables date fields during deep search and keeps direction when the field is reselected', () => {
    useExplorerStore.setState({ deepSearch: true });
    useSettingsStore.setState({ sortMode: 'name-desc' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);

    let sortSelect = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!sortSelect) throw new Error('Sort select was not rendered');
    act(() => sortSelect?.click());
    expect(
      document.querySelector('[role="listbox"] [data-value="release"]')?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      document.querySelector('[role="listbox"] [data-value="update"]')?.getAttribute('aria-disabled'),
    ).toBe('true');

    act(() => sortSelect?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="Sort order:"]')?.click());
    expect(useSettingsStore.getState().sortMode).toBe('name-asc');

    sortSelect = host.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!sortSelect) throw new Error('Sort select was not rendered');
    act(() => sortSelect.click());
    act(() => document.querySelector<HTMLElement>('[role="listbox"] [data-value="name"]')?.click());
    expect(useSettingsStore.getState().sortMode).toBe('name-asc');
    host.remove();
  });

  it('uses the custom sort control and compact UTC date labels', () => {
    useExplorerStore.setState({
      results: [
        { ...items[0]!, firstVersionIndex: 0, firstDateInferred: true },
        { ...items[1]!, firstVersionIndex: -1 },
      ],
      totalMatches: 2,
      versionDates: [Date.UTC(2020, 8, 1)],
      entryDatesStatus: 'loading',
    });
    useSettingsStore.setState({ sortMode: 'release-desc' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);

    expect(host.querySelector('select')).toBeNull();
    expect(host.querySelector('[role="combobox"]')).not.toBeNull();
    const dateLabels = [...host.querySelectorAll<HTMLTimeElement>('time')];
    expect(dateLabels[0]?.textContent).toBe('≤ Sep 2020');
    expect(dateLabels[0]?.dateTime).toBe('2020-09-01T00:00:00.000Z');
    expect(dateLabels[1]?.textContent).toBe('—');
    expect(dateLabels[1]?.title).toBe('Date not recorded in manifest archive');
    expect(host.textContent).toContain('Loading dates…');
    host.remove();
  });

  it('renders list sections with friendly labels and partial/full loaded counts', () => {
    useSettingsStore.setState({ groupBy: 'table' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);

    const headers = [...host.querySelectorAll<HTMLButtonElement>('[data-group-header]')];
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toContain('Inventory Item');
    expect(headers[0]?.textContent).toContain('3 of 5');
    expect(headers[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(headers[1]?.textContent).toContain('Activity');
    expect(headers[1]?.textContent).toContain('3');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(items.length);
    expect(host.querySelectorAll('[data-sticky-group-indicator]')).toHaveLength(1);
    host.remove();
  });

  it('collapses and expands list sections while updating virtual height', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'list' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    setViewport(getScroller(host), 600, 500);

    const virtualSpace = host.querySelector<HTMLElement>('[data-virtual-space]');
    const inventoryHeader = host.querySelector<HTMLButtonElement>(
      '[data-group-header=""][data-group-key="DestinyInventoryItemDefinition"]',
    );
    if (!virtualSpace || !inventoryHeader) throw new Error('Grouped results did not render');
    const expandedHeight = Number.parseFloat(virtualSpace.style.height);
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(items.length);

    act(() => inventoryHeader.click());
    expect(inventoryHeader.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
    const collapsedHeight = Number.parseFloat(virtualSpace.style.height);
    expect(collapsedHeight).toBeLessThan(expandedHeight);

    act(() => inventoryHeader.click());
    expect(inventoryHeader.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(items.length);
    expect(Number.parseFloat(virtualSpace.style.height)).toBe(expandedHeight);
    host.remove();
  });

  it('chunks grid rows inside each table section', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'grid' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    setViewport(getScroller(host), 600, 500);

    const inventoryRows = host.querySelectorAll(
      '[data-group-row="DestinyInventoryItemDefinition"]',
    );
    const activityRows = host.querySelectorAll('[data-group-row="DestinyActivityDefinition"]');
    expect(inventoryRows).toHaveLength(2);
    expect(activityRows).toHaveLength(2);
    expect(inventoryRows[0]?.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(inventoryRows[1]?.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(activityRows[0]?.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(activityRows[1]?.querySelectorAll('[role="option"]')).toHaveLength(1);
    const inventoryHeader = host.querySelector<HTMLElement>(
      '[data-group-header=""][data-group-key="DestinyInventoryItemDefinition"]',
    );
    const firstInventoryRow = inventoryRows[0] as HTMLElement | undefined;
    if (!inventoryHeader || !firstInventoryRow) {
      throw new Error('Grid group header or row did not render');
    }
    expect(Number.parseFloat(inventoryHeader.style.top)).toBe(0);
    expect(
      Number.parseFloat(firstInventoryRow.style.top) -
        Number.parseFloat(inventoryHeader.style.top) -
        Number.parseFloat(inventoryHeader.style.height),
    ).toBe(8);
    expect((inventoryRows[1] as HTMLElement | undefined)?.className).not.toContain('gridRowEnd');
    dispatchScroll(
      getScroller(host),
      Number.parseFloat(inventoryHeader.style.top) +
        Number.parseFloat(inventoryHeader.style.height) +
        1,
    );
    expect(
      host
        .querySelector('[data-sticky-group-indicator]')
        ?.getAttribute('aria-hidden'),
    ).toBe('false');

    const activityHeader = host.querySelector<HTMLElement>(
      '[data-group-key="DestinyActivityDefinition"]',
    );
    if (!activityHeader) throw new Error('Grid group headers did not render');
    const activityTopBefore = Number.parseFloat(activityHeader.style.top);
    act(() => inventoryHeader.click());
    expect(inventoryHeader.getAttribute('aria-expanded')).toBe('false');
    expect(
      host.querySelectorAll('[data-group-row="DestinyInventoryItemDefinition"]'),
    ).toHaveLength(0);
    expect(
      host.querySelectorAll('[data-group-row="DestinyActivityDefinition"]'),
    ).toHaveLength(2);
    const activityHeaderAfter = host.querySelector<HTMLElement>(
      '[data-group-key="DestinyActivityDefinition"]',
    );
    expect(Number.parseFloat(activityHeaderAfter?.style.top ?? '')).toBeLessThan(
      activityTopBefore,
    );
    host.remove();
  });

  it('uses responsive grid columns and keeps table names in card metadata', () => {
    useSettingsStore.setState({ viewMode: 'grid', groupBy: 'none' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    const scroller = getScroller(host);
    const firstGridRow = (): HTMLElement | undefined =>
      [...host.querySelectorAll<HTMLElement>('[role="presentation"]')].find(
        (element) => element.style.gridTemplateColumns.length > 0,
      );

    setViewport(scroller, 390, 500);
    expect(firstGridRow()?.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    const firstCard = host.querySelector<HTMLElement>('[role="option"]');
    expect(firstCard?.textContent).toContain('Weapon');
    expect(firstCard?.querySelector('span[title="Inventory Item"]')?.textContent).toBe(
      'Inventory Item',
    );

    setViewport(scroller, 1920, 500);
    expect(firstGridRow()?.style.gridTemplateColumns).toBe('repeat(9, minmax(0, 1fr))');

    act(() => {
      useExplorerStore.setState({
        filters: { ...createDefaultFilters(), table: 'DestinyInventoryItemDefinition' },
      });
    });
    expect(host.querySelector('span[title="Inventory Item"]')).toBeNull();
    host.remove();
  });

  it('includes the grouped grid gap when scrolling a selected result into view', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'grid' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    const scroller = getScroller(host);
    setViewport(scroller, 600, 100);

    const activityHeader = host.querySelector<HTMLElement>(
      '[data-group-header=""][data-group-key="DestinyActivityDefinition"]',
    );
    if (!activityHeader) throw new Error('Activity group header did not render');
    const headerTop = Number.parseFloat(activityHeader.style.top);

    act(() => useExplorerStore.getState().setSelectedResultIndex(3));
    // 32px group header + 8px grid gap + one 66px (4.125rem) grid row.
    expect(scroller.scrollTop).toBe(headerTop + 32 + 8 + 66 - 100);
    host.remove();
  });

  it('collapses from the sticky section header and snaps to that section top', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'list' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    const scroller = getScroller(host);
    setViewport(scroller, 600, 100);
    dispatchScroll(scroller, 220);

    const stickyHeader = host.querySelector<HTMLButtonElement>(
      '[data-sticky-group-indicator]',
    );
    const activityHeader = host.querySelector<HTMLButtonElement>(
      '[data-group-header=""][data-group-key="DestinyActivityDefinition"]',
    );
    if (!stickyHeader || !activityHeader) throw new Error('Sticky group header did not render');
    const activityTop = Number.parseFloat(activityHeader.style.top);
    expect(stickyHeader.disabled).toBe(false);
    expect(stickyHeader.getAttribute('aria-expanded')).toBe('true');

    act(() => stickyHeader.click());
    expect(activityHeader.getAttribute('aria-expanded')).toBe('false');
    expect(scroller.scrollTop).toBe(activityTop);
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(3);
    host.remove();
  });

  it('resets collapsed sections for a new query but preserves them while loading more', () => {
    const store = useExplorerStore.getState();
    store.toggleResultGroup(groups[0]!.key);
    expect(useExplorerStore.getState().collapsedResultGroups[groups[0]!.key]).toBe(true);

    useExplorerStore.getState().setSearchResults(items, items.length + 10, 0, true, 0, 0, groups);
    expect(useExplorerStore.getState().collapsedResultGroups[groups[0]!.key]).toBe(true);

    useExplorerStore.getState().setSearching(true);
    expect(useExplorerStore.getState().collapsedResultGroups).toEqual({});
    useExplorerStore.getState().toggleResultGroup(groups[0]!.key);
    useExplorerStore.getState().setQuery('armor');
    expect(useExplorerStore.getState().collapsedResultGroups).toEqual({});
  });

  it('scrolls a keyboard-selected item in a collapsed section to its header', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'list' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    const scroller = getScroller(host);
    setViewport(scroller, 600, 100);

    act(() => useExplorerStore.getState().setSelectedResultIndex(4));
    expect(scroller.scrollTop).toBe(204);

    act(() => useExplorerStore.getState().toggleResultGroup(groups[1]!.key));
    act(() => useExplorerStore.getState().setSelectedResultIndex(3));
    expect(scroller.scrollTop).toBe(176);
    host.remove();
  });

  it('scrolls a keyboard-selected item using its section header offset', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'list' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    const scroller = getScroller(host);
    setViewport(scroller, 600, 100);

    act(() => useExplorerStore.getState().setSelectedResultIndex(4));
    expect(scroller.scrollTop).toBe(204);

    dispatchScroll(scroller, 40);
    const indicator = host.querySelector<HTMLElement>('[data-sticky-group-indicator]');
    expect(indicator?.textContent).toContain('Inventory Item');
    host.remove();
  });

  it('isolates scroll restoration when groupBy changes', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const firstRoot = createPaneRoot(host);
    renderPane(firstRoot);
    const firstScroller = getScroller(host);
    dispatchScroll(firstScroller, 620);

    act(() => useSettingsStore.getState().setGroupBy('table'));
    expect(firstScroller.scrollTop).toBe(0);
    dispatchScroll(firstScroller, 340);
    unmountRoot(firstRoot);

    const secondRoot = createPaneRoot(host);
    renderPane(secondRoot);
    expect(getScroller(host).scrollTop).toBe(340);
    host.remove();
  });
});
