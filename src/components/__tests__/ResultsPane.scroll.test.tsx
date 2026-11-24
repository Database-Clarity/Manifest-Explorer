/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultsPane, resetSavedResultsScroll } from '../ResultsPane';
import { createDefaultFilters, useExplorerStore } from '../../stores/explorer';
import type { SearchResultItem } from '../../types/manifest';

const items: SearchResultItem[] = Array.from({ length: 120 }, (_, index) => ({
  hash: index + 1,
  table: 'DestinyInventoryItemDefinition',
  name: `Result ${index + 1}`,
  subtitle: 'Weapon',
}));

let roots: Root[] = [];

function renderPane(root: Root, onOpenItem = vi.fn()): void {
  act(() => {
    root.render(
      <ResultsPane
        onOpenItem={onOpenItem}
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

describe('ResultsPane scroll restoration', () => {
  it('restores the exact scroll offset after opening an entry unmounts the pane', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onOpenItem = vi.fn();
    const firstRoot = createPaneRoot(host);
    renderPane(firstRoot, onOpenItem);

    const scroller = getScroller(host);
    dispatchScroll(scroller, 1379);
    act(() => {
      host.querySelector<HTMLElement>('[role="option"]')?.click();
    });
    expect(onOpenItem).toHaveBeenCalledOnce();

    unmountRoot(firstRoot);
    const secondRoot = createPaneRoot(host);
    renderPane(secondRoot);

    expect(getScroller(host).scrollTop).toBe(1379);
    host.remove();
  });

  it('keeps a pending offset until results finish loading after remount', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const firstRoot = createPaneRoot(host);
    renderPane(firstRoot);
    dispatchScroll(getScroller(host), 1690);
    unmountRoot(firstRoot);

    act(() => {
      useExplorerStore.setState({ results: [], totalMatches: 0 });
    });
    const secondRoot = createPaneRoot(host);
    renderPane(secondRoot);
    expect(getScroller(host).scrollTop).toBe(0);

    act(() => {
      useExplorerStore.setState({ results: items, totalMatches: items.length });
    });
    expect(getScroller(host).scrollTop).toBe(1690);
    host.remove();
  });

  it('resets the scroll offset when the query or filters change', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createPaneRoot(host);
    renderPane(root);

    dispatchScroll(getScroller(host), 840);
    act(() => {
      useExplorerStore.setState({ query: 'armor' });
    });
    expect(getScroller(host).scrollTop).toBe(0);

    dispatchScroll(getScroller(host), 520);
    act(() => {
      useExplorerStore.setState({
        filters: { ...useExplorerStore.getState().filters, tierTypes: [6] },
      });
    });
    expect(getScroller(host).scrollTop).toBe(0);
    host.remove();
  });
});
