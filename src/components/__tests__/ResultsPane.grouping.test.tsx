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

    const headers = [...host.querySelectorAll<HTMLElement>('[data-group-header]')];
    expect(headers).toHaveLength(2);
    expect(headers[0]?.textContent).toContain('Inventory Item');
    expect(headers[0]?.textContent).toContain('3 of 5');
    expect(headers[1]?.textContent).toContain('Activity');
    expect(headers[1]?.textContent).toContain('3');
    expect(host.querySelectorAll('[role="option"]')).toHaveLength(items.length);
    expect(host.querySelectorAll('[data-sticky-group-indicator]')).toHaveLength(1);
    host.remove();
  });

  it('chunks grid rows inside each table section', () => {
    useSettingsStore.setState({ groupBy: 'table', viewMode: 'grid' });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);
    setViewport(getScroller(host), 500, 500);

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
