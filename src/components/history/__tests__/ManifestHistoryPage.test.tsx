/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../manifest/history', () => ({
  fetchHistoryVersionsIndex: vi.fn(async () => ({
    schema: 1,
    generatedAt: '2024-01-01T00:00:00.000Z',
    buckets: {},
    versions: [
      { i: 2, id: 'manifest-2', version: '2.0.0.1', date: '2024-01-01', source: 'test' },
      {
        i: 1,
        id: 'manifest-1',
        version: '1.0.0.1',
        date: '2020-07-07',
        source: 'test',
        gapBefore: true,
      },
      { i: 0, id: 'manifest-0', version: '0.0.0.1', date: '2020-06-01', source: 'test' },
    ],
  })),
  getHistoryRevision: vi.fn(() => 'test-revision'),
  fetchManifestRelease: vi.fn(async (versionIndex: number) => ({
    v: versionIndex,
    date: versionIndex === 1 ? '2020-07-07' : '2024-01-01',
    version: `test.${versionIndex}`,
    totals: { a: 1, m: 0, r: 0, u: 0, c: 0 },
    tables: {
      DestinyInventoryItemDefinition: {
        a: [
          [1234, 'Test Item', 'Weapon', '', 3],
          [5678, 'Second Item', 'Weapon', '', 4],
        ],
      },
    },
  })),
  fetchItemHistory: vi.fn(async () => ({
    available: true,
    versions: [],
    revisions: [],
  })),
  reconstructRemovedSnapshot: vi.fn(() => null),
  reconstructRevisionSnapshot: vi.fn(() => null),
}));

vi.mock('../../../manifest/client', () => ({
  getDefinition: vi.fn(async () => null),
}));

import { ManifestHistoryPage } from '../ManifestHistoryPage';

let roots: Root[] = [];
let isMobileViewport = false;

function mockMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) => ({
      matches: isMobileViewport && media === '(max-width: 700px)',
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function mountPage(host: HTMLElement): Root {
  const root = createRoot(host);
  roots.push(root);
  return root;
}

async function renderHistory(
  root: Root,
  versionIndex = 2,
  onSelectVersion: (versionIndex: number, replace?: boolean) => void = () => {},
): Promise<void> {
  await act(async () => {
    root.render(
      <ManifestHistoryPage
        versionIndex={versionIndex}
        onSelectVersion={onSelectVersion}
        onNavigateExplorer={() => {}}
      />,
    );
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

async function flushHistoryLoads(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  });
}

function expandRelease(host: HTMLElement): void {
  const expandAll = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.includes('Expand all'),
  );
  if (!expandAll) throw new Error('Expand all button is missing');
  act(() => expandAll.click());
}

function openTestEntry(host: HTMLElement): void {
  const card = host.querySelector<HTMLButtonElement>(
    'button[title="Open Test Item history diff"]',
  );
  if (!card) throw new Error('Test Item release card is missing');
  act(() => card.click());
}

function openSecondEntry(host: HTMLElement): void {
  const card = host.querySelector<HTMLButtonElement>(
    'button[title="Open Second Item history diff"]',
  );
  if (!card) throw new Error('Second Item release card is missing');
  act(() => card.click());
}

beforeEach(() => {
  roots = [];
  isMobileViewport = false;
  mockMatchMedia();
  window.history.replaceState(null, '', '/history');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of [...roots]) {
    act(() => root.unmount());
  }
  roots = [];
  window.history.replaceState(null, '', '/');
});

describe('ManifestHistoryPage workspace', () => {
  it('does not render a Release overview tab and provides adjacent version navigation', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountPage(host);
    const onSelectVersion = vi.fn();
    await renderHistory(root, 2, onSelectVersion);

    expect(host.querySelector('[role="tab"][aria-selected="true"]')).toBeNull();
    expect(host.textContent).not.toContain('Release overview');
    expect(host.querySelector('[aria-label="Older release"]')?.getAttribute('title')).toBe(
      'Jul 7, 2020',
    );
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Newer release"]')?.disabled).toBe(
      true,
    );

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Older release"]')?.click());
    expect(onSelectVersion).toHaveBeenLastCalledWith(1);
    await renderHistory(root, 1, onSelectVersion);
    await flushHistoryLoads();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Newer release"]')?.click());
    expect(onSelectVersion).toHaveBeenLastCalledWith(2);
    await renderHistory(root, 0, onSelectVersion);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Older release"]')?.disabled).toBe(
      true,
    );

    host.remove();
  });

  it('opens an entry in a split inspector tab and returns to the overview when the last tab closes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountPage(host);
    await renderHistory(root);
    expandRelease(host);
    openTestEntry(host);
    await flushHistoryLoads();

    expect(host.querySelector('[aria-label="Resize release changes pane"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="History entry diffs"]')).not.toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      'Test Item',
    );

    act(() =>
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Close Test Item history tab"]',
      )?.click(),
    );
    expect(host.querySelector('[aria-label="History diff inspector"]')).toBeNull();
    expect(host.querySelector('[aria-label="Resize release changes pane"]')).toBeNull();
    expect(host.querySelector('[aria-label="Release changes"]')).not.toBeNull();

    host.remove();
  });

  it('shows the mobile Back sheet and preserves the release scroll position and open tabs', async () => {
    isMobileViewport = true;
    mockMatchMedia();
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountPage(host);
    await renderHistory(root);

    expandRelease(host);
    const overviewScroll = host.querySelector<HTMLElement>('[class*="overviewScroll"]');
    if (!overviewScroll) throw new Error('Release overview scroller is missing');
    overviewScroll.scrollTop = 420;
    openTestEntry(host);
    await flushHistoryLoads();

    expect(host.querySelector('[aria-label="Back to release changes"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="History entry diffs"]')).not.toBeNull();
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Back to release changes"]')?.click(),
    );

    expect(overviewScroll.scrollTop).toBe(420);
    expect(host.querySelector('[aria-label="Return to open tabs, 1"]')?.textContent).toContain(
      'Tabs (1)',
    );
    expect(host.querySelector('[aria-label="Back to release changes"]')).toBeNull();
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Return to open tabs, 1"]')?.click(),
    );
    expect(host.querySelector('[aria-label="Back to release changes"]')).not.toBeNull();

    host.remove();
  });

  it('pushes a mobile diff-sheet history state and closes it on browser Back without losing tabs', async () => {
    isMobileViewport = true;
    mockMatchMedia();
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountPage(host);
    await renderHistory(root);
    expandRelease(host);
    openTestEntry(host);
    await flushHistoryLoads();

    expect(window.history.state).toMatchObject({ historyDiffSheet: true });
    expect(window.location.pathname).toBe('/history');
    expect(host.querySelector('[aria-label="Back to release changes"]')).not.toBeNull();

    window.history.replaceState({ releaseChanges: true }, '', window.location.href);
    act(() => {
      window.dispatchEvent(
        new PopStateEvent('popstate', { state: window.history.state }),
      );
    });

    expect(window.location.pathname).toBe('/history');
    expect(host.querySelector('[aria-label="Back to release changes"]')).toBeNull();
    expect(host.querySelector('[aria-label="Return to open tabs, 1"]')?.textContent).toContain(
      'Tabs (1)',
    );
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      'Test Item',
    );

    host.remove();
  });

  it('uses browser history for the in-app mobile Back button instead of leaving a sheet entry behind', async () => {
    isMobileViewport = true;
    mockMatchMedia();
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountPage(host);
    await renderHistory(root);
    expandRelease(host);
    openTestEntry(host);
    await flushHistoryLoads();

    expect(window.history.state).toMatchObject({ historyDiffSheet: true });
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="Back to release changes"]')?.click(),
    );
    await flushHistoryLoads();

    expect(window.location.pathname).toBe('/history');
    expect(window.history.state?.historyDiffSheet).toBeFalsy();
    expect(host.querySelector('[aria-label="Back to release changes"]')).toBeNull();
    expect(host.querySelector('[aria-label="Return to open tabs, 1"]')).not.toBeNull();

    host.remove();
  });

  it('scrolls newly opened and reactivated history tabs fully into the visible tab strip', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = mountPage(host);
    await renderHistory(root);
    expandRelease(host);
    openTestEntry(host);
    await flushHistoryLoads();

    const tabs = host.querySelector<HTMLElement>(
      '[role="tablist"][aria-label="History entry diffs"]',
    );
    if (!tabs) throw new Error('History tab strip is missing');
    Object.defineProperty(tabs, 'clientWidth', { configurable: true, value: 200 });
    Object.defineProperty(tabs, 'scrollWidth', { configurable: true, value: 500 });

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this === tabs) {
        return {
          x: 100,
          y: 0,
          left: 100,
          right: 300,
          top: 0,
          bottom: 40,
          width: 200,
          height: 40,
          toJSON: () => ({}),
        };
      }
      if (this.className.toString().includes('entryTab')) {
        const label = this.querySelector('[role="tab"]')?.textContent ?? '';
        const baseLeft = label.includes('Second Item') ? 280 : 110;
        const left = baseLeft - tabs.scrollLeft;
        return {
          x: left,
          y: 0,
          left,
          right: left + 100,
          top: 0,
          bottom: 40,
          width: 100,
          height: 40,
          toJSON: () => ({}),
        };
      }
      return originalGetBoundingClientRect.call(this);
    };

    try {
      openSecondEntry(host);
      await flushHistoryLoads();
      const activeTab = host.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      )?.parentElement;
      if (!activeTab) throw new Error('Active history tab is missing');
      let activeRect = activeTab.getBoundingClientRect();
      expect(tabs.scrollLeft).toBeGreaterThan(0);
      expect(activeRect.left).toBeGreaterThanOrEqual(100);
      expect(activeRect.right).toBeLessThanOrEqual(300);

      act(() =>
        host.querySelector<HTMLButtonElement>(
          '[role="tab"][aria-selected="false"]',
        )?.click(),
      );
      const reactivatedTab = host.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      )?.parentElement;
      if (!reactivatedTab) throw new Error('Reactivated history tab is missing');
      activeRect = reactivatedTab.getBoundingClientRect();
      expect(tabs.scrollLeft).toBeLessThan(10);
      expect(activeRect.left).toBeGreaterThanOrEqual(100);
      expect(activeRect.right).toBeLessThanOrEqual(300);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }

    host.remove();
  });
});
