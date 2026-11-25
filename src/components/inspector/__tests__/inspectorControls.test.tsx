/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionDetailPayload } from '../../../types/manifest';
import { JsonDiffView } from '../JsonDiffView';
import { JsonTree } from '../JsonTree';
import { OverviewTab } from '../OverviewTab';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedView {
  host: HTMLDivElement;
  root: Root;
}

const mounted: MountedView[] = [];

function mount(node: ReactNode): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  act(() => root.render(node));
  return host;
}

function clickButton(host: HTMLElement, label: string | RegExp): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((candidate) =>
    typeof label === 'string'
      ? candidate.textContent?.trim() === label
      : label.test(candidate.textContent?.trim() ?? ''),
  );
  if (!button) throw new Error(`Could not find button ${String(label)}`);
  act(() => button.click());
  return button;
}

function treeProps(
  data: Record<string, unknown>,
  diffBefore?: unknown,
  overrides: Partial<React.ComponentProps<typeof JsonTree>> = {},
): ReactNode {
  return createElement(JsonTree, {
    data,
    diffBefore,
    resolvedRefs: {},
    onNavigateRef: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  });
}

function nestedData(): Record<string, unknown> {
  const deep = { leaf: 'value' };
  const payload = {
    nested: {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: {
                  level7: deep,
                },
              },
            },
          },
        },
      },
    },
    values: Array.from({ length: 130 }, (_, index) => ({ index })),
  };
  return { payload };
}

function rowCount(host: HTMLElement): number {
  return host.querySelectorAll('[data-json-row-path]').length;
}

afterEach(() => {
  act(() => {
    for (const view of mounted.splice(0)) view.root.unmount();
  });
  document.body.replaceChildren();
});

describe('Inspector JSON controls', () => {
  it('expands and collapses every nested snapshot node, including deep and chunked children', () => {
    const host = mount(treeProps(nestedData()));
    const initial = rowCount(host);

    clickButton(host, 'Expand');
    const expanded = rowCount(host);
    expect(expanded).toBeGreaterThan(initial);
    expect(host.querySelector('[data-json-row-path*="level7"]')).not.toBeNull();
    expect(host.querySelector('[data-json-row-path="payload.values[129]"]')).not.toBeNull();

    clickButton(host, 'Collapse');
    expect(rowCount(host)).toBeLessThan(expanded);
  });

  it('keeps unchanged inspector snapshots on the regular Expand and Collapse controls', () => {
    const host = mount(treeProps({ payload: { nested: { value: 'present' } } }));
    expect(host.querySelector('button')?.textContent).not.toContain('Changes');
    expect(Array.from(host.querySelectorAll('button')).some((button) =>
      button.textContent?.trim() === 'Expand',
    )).toBe(true);
    expect(Array.from(host.querySelectorAll('button')).some((button) =>
      button.textContent?.trim() === 'Collapse',
    )).toBe(true);
  });

  it('expands and collapses all changed nodes in diff mode', () => {
    const before = {
      payload: {
        nested: { level1: { level2: { value: 'before' } } },
        values: Array.from({ length: 130 }, (_, index) => `before-${index}`),
      },
    };
    const after = {
      payload: {
        nested: { level1: { level2: { value: 'after' } } },
        values: Array.from({ length: 130 }, (_, index) => `after-${index}`),
      },
    };
    const host = mount(treeProps(after, before));
    const initial = rowCount(host);

    clickButton(host, 'Expand all');
    const expanded = rowCount(host);
    expect(expanded).toBeGreaterThan(initial);
    expect(host.querySelector('[data-json-row-path="payload.values[129]"]')).not.toBeNull();

    clickButton(host, 'Collapse all');
    const collapsed = rowCount(host);
    expect(collapsed).toBeLessThan(expanded);
    expect(host.querySelector('[data-json-row-path="payload.values[129]"]')).toBeNull();
  });

  it('shows full formatted context while preserving the changed-value highlight', () => {
    const before = {
      meta: { same: 'kept', changed: 'before' },
      rootSame: 'also kept',
    };
    const after = {
      meta: { same: 'kept', changed: 'after' },
      rootSame: 'also kept',
    };
    const host = mount(treeProps(after, before));

    expect(host.querySelector('[data-json-row-path="rootSame"]')).toBeNull();
    clickButton(host, 'Full');

    expect(host.querySelector('[data-json-row-path="rootSame"]')).not.toBeNull();
    expect(host.querySelector('[data-json-row-path="meta.same"]')).not.toBeNull();
    expect(host.textContent).toContain('before');
    expect(host.textContent).toContain('after');
    expect(host.querySelector('[aria-label="Changed"]')).not.toBeNull();
  });

  it('reveals unchanged siblings locally inside changed objects and at the root', () => {
    const before = {
      meta: { same: 'nested context', changed: 'before' },
      rootSame: 'root context',
    };
    const after = {
      meta: { same: 'nested context', changed: 'after' },
      rootSame: 'root context',
    };
    const host = mount(treeProps(after, before));

    expect(host.querySelector('[data-json-row-path="meta.same"]')).toBeNull();
    expect(host.querySelector('[data-json-row-path="rootSame"]')).toBeNull();
    clickButton(host, '⋯ Show 1 unchanged field');
    expect(host.querySelector('[data-json-row-path="meta.same"]')).not.toBeNull();
    expect(host.querySelector('[data-json-row-path="rootSame"]')).toBeNull();

    clickButton(host, '⋯ Show 1 unchanged field');
    expect(host.querySelector('[data-json-row-path="rootSame"]')).not.toBeNull();
  });

  it('Expand all bypasses chunking and Collapse unchanged returns to changed paths', () => {
    const before = {
      values: Array.from({ length: 130 }, (_, index) => `before-${index}`),
      same: 'context',
    };
    const after = {
      values: Array.from({ length: 130 }, (_, index) => `after-${index}`),
      same: 'context',
    };
    const host = mount(treeProps(after, before));

    expect(host.querySelector('[data-json-row-path="values[129]"]')).toBeNull();
    clickButton(host, 'Expand all');
    expect(host.querySelector('[data-json-row-path="values[129]"]')).not.toBeNull();
    expect(host.querySelector('[data-json-row-path="same"]')).not.toBeNull();
    expect(host.textContent).toContain('Collapse unchanged');

    clickButton(host, 'Collapse unchanged');
    expect(host.querySelector('[data-json-row-path="values[129]"]')).toBeNull();
    expect(host.querySelector('[data-json-row-path="same"]')).toBeNull();
    expect(host.textContent).toContain('Expand all');
  });

  it('renders Added and Removed fields with diff markers in Changes and Full modes', () => {
    const added = mount(treeProps({ name: 'New definition' }, null));
    expect(added.querySelector('[data-json-row-path="name"]')).not.toBeNull();
    expect(added.querySelector('[aria-label="Added"]')).not.toBeNull();
    clickButton(added, 'Full');
    expect(added.querySelector('[data-json-row-path="name"]')).not.toBeNull();
    expect(added.querySelector('[aria-label="Added"]')).not.toBeNull();
    clickButton(added, 'Expand all');
    expect(added.textContent).toContain('Collapse all');
    clickButton(added, 'Collapse all');
    expect(added.textContent).toContain('Expand all');

    const removed = mount(treeProps({}, { name: 'Removed definition' }));
    expect(removed.querySelector('[data-json-row-path="name"]')).not.toBeNull();
    expect(removed.querySelector('[aria-label="Removed"]')).not.toBeNull();
    clickButton(removed, 'Full');
    expect(removed.querySelector('[data-json-row-path="name"]')).not.toBeNull();
    expect(removed.querySelector('[aria-label="Removed"]')).not.toBeNull();
  });

  it('adds Copy and Download controls to the formatted diff toolbar', () => {
    const onCopy = vi.fn();
    const data = { value: 'snapshot' };
    const host = mount(treeProps(data, {}, { onCopy }));

    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Copy',
      ),
    ).toBe(true);
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Download .json',
      ),
    ).toBe(true);
    clickButton(host, 'Copy');
    expect(onCopy).toHaveBeenCalledWith(
      JSON.stringify(data, null, 2),
      'Copied JSON snapshot',
    );
  });

  it('keeps the History mode toggle beside the summary on the far-left toolbar slot', () => {
    const host = mount(
      treeProps(
        { value: 'after', unchanged: 'context' },
        { value: 'before', unchanged: 'context' },
        { toolbarLeading: createElement('button', { type: 'button' }, 'History mode') },
      ),
    );

    const toolbarInfo = host.querySelector('[class*="toolbarInfo"]');
    const toolbarActions = host.querySelector('[class*="diffToolbarActions"]');
    expect(toolbarInfo?.textContent).toContain('History mode');
    expect(toolbarInfo?.textContent).toContain('~1 change');
    expect(toolbarActions?.textContent).not.toContain('History mode');
    expect(toolbarActions?.textContent).toContain('Changes');
    expect(toolbarActions?.textContent).toContain('Full');
  });

  it('hides Filter and Find controls while retaining leading controls and tree actions', () => {
    const host = mount(
      treeProps({ payload: { value: 1 } }, undefined, {
        hideSearch: true,
        toolbarLeading: createElement('span', null, 'History controls'),
      }),
    );

    expect(host.textContent).toContain('History controls');
    expect(host.querySelector('[aria-label="JSON search mode"]')).toBeNull();
    expect(host.querySelector('[aria-label="Filter JSON keys or values"]')).toBeNull();
    expect(
      Array.from(host.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Expand',
      ),
    ).toBe(true);
  });

  it('shows resolved Bungie icons inside reference pills', () => {
    const host = mount(
      treeProps(
        { plugs: [{ plugItemHash: 839105230 }] },
        undefined,
        {
          resolvedRefs: {
            'DestinyInventoryItemDefinition:839105230': {
              table: 'DestinyInventoryItemDefinition',
              hash: 839105230,
              name: 'Arrowhead Brake',
              subtitle: 'Weapon Mod',
              icon: '/icons/arrowhead-brake.png',
            },
          },
        },
      ),
    );
    clickButton(host, 'Expand');

    const pill = host.querySelector(
      'button[title*="DestinyInventoryItemDefinition:839105230"]',
    );
    expect(pill?.textContent).toContain('Arrowhead Brake');
    expect(pill?.querySelector('img')).not.toBeNull();
  });
});

describe('JSON diff expansion and Wave-2 toolbar props', () => {
  const before = {
    ...Object.fromEntries(Array.from({ length: 460 }, (_, index) => [`field${index}`, index])),
    changed: 'old',
  };
  const after = { ...before, changed: 'new' };

  it('lets a per-gap Expand all reveal more than 400 hidden lines', () => {
    const host = mount(createElement(JsonDiffView, { before, after }));
    const allGapButtons = Array.from(host.querySelectorAll('button')).filter((button) =>
      /^Expand all \(\d+ lines\)$/.test(button.textContent?.trim() ?? ''),
    );
    expect(allGapButtons.length).toBeGreaterThan(0);
    expect(Number(allGapButtons[0]?.textContent?.match(/\((\d+) lines\)/)?.[1])).toBeGreaterThan(
      400,
    );
    act(() => allGapButtons[0]?.click());
    expect(host.querySelectorAll('[aria-label="More diff lines"]')).toHaveLength(0);
    expect(host.textContent).not.toMatch(/\d+ hidden lines/);
  });

  it('removes the render cap when the diff toolbar Expand all is clicked', () => {
    const host = mount(createElement(JsonDiffView, { before, after }));
    clickButton(host, 'Expand all');

    expect(host.querySelectorAll('[aria-label="More diff lines"]')).toHaveLength(0);
    expect(host.textContent).not.toMatch(/\d+ hidden lines/);
    expect(host.textContent).toContain('"field459"');
  });

  it('supports a controlled layout and places toolbar-leading content on the far left', () => {
    const onLayoutChange = vi.fn();
    const host = mount(
      createElement(JsonDiffView, {
        before: { value: 1 },
        after: { value: 2 },
        layout: 'split',
        onLayoutChange,
        toolbarLeading: createElement('button', { type: 'button' }, 'Wave 2'),
      }),
    );

    const toolbarInfo = host.querySelector('[class*="toolbarInfo"]');
    const toolbarActions = host.querySelector('[class*="toolbarActions"]');
    expect(toolbarInfo?.textContent).toContain('Wave 2');
    expect(toolbarActions?.textContent).not.toContain('Wave 2');
    expect(
      host.querySelector('button[aria-pressed="true"]')?.textContent?.trim(),
    ).toBe('Split');
    clickButton(host, 'Inline');
    expect(onLayoutChange).toHaveBeenCalledWith('inline');
  });
});

describe('Overview navigation', () => {
  function overviewProps(detail: DefinitionDetailPayload, onNavigateRef = vi.fn()) {
    return {
      detail,
      loadingFull: false,
      clarityEntry: null,
      clarityLoading: false,
      showClarity: false,
      imageScaling: 'sharp' as const,
      onNavigateRef,
      onCopy: vi.fn(),
      onLoadFullItem: vi.fn(),
    };
  }

  it('opens both reusable and randomized PlugSets from every socket and expands all socket pools', () => {
    const onNavigateRef = vi.fn();
    const plugs = Array.from({ length: 22 }, (_, index) => ({
      hash: 1000 + index,
      name: `Perk ${index}`,
      itemTypeDisplayName: 'Weapon Perk',
      description: '',
    }));
    const detail: DefinitionDetailPayload = {
      table: 'DestinyInventoryItemDefinition',
      hash: 1,
      data: {
        sockets: {
          socketEntries: [
            { reusablePlugSetHash: 10, randomizedPlugSetHash: 20 },
            { randomizedPlugSetHash: 30 },
          ],
        },
      },
      coTables: [],
      resolvedRefs: {},
      overview: {
        socketCategories: [
          {
            categoryHash: 5,
            name: 'Weapon Perks',
            sockets: [
              {
                socketIndex: 0,
                socketTypeName: 'Perk Slot',
                plugs,
                plugSetHash: 10,
                isRandomized: true,
              },
              {
                socketIndex: 1,
                socketTypeName: 'Randomized Slot',
                plugs,
                isRandomized: true,
              },
            ],
          },
        ],
      },
    };
    const host = mount(createElement(OverviewTab, overviewProps(detail, onNavigateRef)));

    const plugSet20 = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'PlugSet 20',
    );
    const plugSet30 = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'PlugSet 30',
    );
    expect(plugSet20).not.toBeUndefined();
    expect(plugSet30).not.toBeUndefined();
    act(() => plugSet20?.click());
    expect(onNavigateRef).toHaveBeenCalledWith(
      { table: 'DestinyPlugSetDefinition', hash: 20 },
      false,
    );

    clickButton(host, 'Expand all');
    const expandedSlots = Array.from(host.querySelectorAll('button[aria-expanded="true"]'));
    expect(expandedSlots.length).toBe(3);
    clickButton(host, 'Collapse all');
    expect(host.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(0);
  });

  it('renders a searchable PlugSet summary and navigable resolved item rows', () => {
    const onNavigateRef = vi.fn();
    const reusablePlugItems = Array.from({ length: 13 }, (_, index) => ({
      plugItemHash: 7000 + index,
      currentlyCanRoll: index !== 0,
    }));
    const resolvedRefs = Object.fromEntries(
      reusablePlugItems.map((item, index) => [
        `DestinyInventoryItemDefinition:${item.plugItemHash}`,
        {
          table: 'DestinyInventoryItemDefinition',
          hash: item.plugItemHash,
          name: `Plug ${index}`,
          subtitle: 'Weapon Mod',
          icon: `/icons/plug-${index}.png`,
        },
      ]),
    );
    const detail: DefinitionDetailPayload = {
      table: 'DestinyPlugSetDefinition',
      hash: 811071122,
      data: { reusablePlugItems },
      coTables: [],
      resolvedRefs,
    };
    const host = mount(createElement(OverviewTab, overviewProps(detail, onNavigateRef)));

    expect(host.textContent).toContain('PlugSet Overview');
    expect(host.textContent).toContain('13 plugs');
    expect(host.textContent).toContain('12 rollable');
    expect(host.textContent).toContain('1 retired');
    const filter = host.querySelector<HTMLInputElement>(
      'input[aria-label="Filter PlugSet 811071122 plugs"]',
    );
    expect(filter).not.toBeNull();
    expect(host.textContent).toContain('Retired');

    const firstPlug = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Plug 0'),
    );
    act(() => firstPlug?.click());
    expect(onNavigateRef).toHaveBeenCalledWith(
      {
        table: 'DestinyInventoryItemDefinition',
        hash: 7000,
        label: 'Plug 0',
        icon: '/icons/plug-0.png',
      },
      false,
    );
  });
});
