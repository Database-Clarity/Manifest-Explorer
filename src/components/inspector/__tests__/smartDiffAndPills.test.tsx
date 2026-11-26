/** @vitest-environment jsdom */

import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTargetTablesForField } from '../../../manifest/hash';
import type { ResolvedHashSummary } from '../../../types/manifest';
import { JsonDiffView } from '../JsonDiffView';
import { JsonTree } from '../JsonTree';

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

function tree(
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

function rowStatus(host: HTMLElement, path: string, status: string): Element | null {
  return host
    .querySelector(`[data-json-row-path="${path}"]`)
    ?.querySelector(`[aria-label="${status}"]`) ?? null;
}

afterEach(() => {
  act(() => {
    for (const view of mounted.splice(0)) view.root.unmount();
  });
  document.body.replaceChildren();
});

describe('smart JSON diff and context pills', () => {
  it('keeps comma-only line differences as valid context on both split sides', () => {
    const onStats = vi.fn();
    const host = mount(
      createElement(JsonDiffView, {
        before: { traitIds: ['item.armor.head', 'releases.v460.season'] },
        after: { traitIds: ['item.armor.head'] },
        layout: 'split',
        onStats,
      }),
    );

    const cells = Array.from(host.querySelectorAll('[class*="splitCell"]')).filter(
      (cell) => cell.textContent?.includes('"item.armor.head"'),
    );
    expect(cells).toHaveLength(2);
    expect(cells[0]?.textContent).toContain('"item.armor.head",');
    expect(cells[1]?.textContent).toContain('"item.armor.head"');
    expect(cells[1]?.textContent).not.toContain('"item.armor.head",');
    expect(onStats).toHaveBeenLastCalledWith({ added: 0, removed: 1 });
  });

  it('renders inline value spans in both layouts and composes search highlighting', () => {
    const before = { displayName: 'A very bright Amber blade' };
    const after = { displayName: 'A very bright Azure blade' };
    const inline = mount(
      createElement(JsonDiffView, {
        before,
        after,
        layout: 'inline',
        filter: 'Azure',
      }),
    );

    expect(inline.querySelector('mark[class*="inlineRemoved"]')).not.toBeNull();
    const inlineAdded = inline.querySelector('mark[class*="inlineAdded"]');
    expect(inlineAdded).not.toBeNull();
    expect(inlineAdded?.querySelector('mark[class*="match"]')).not.toBeNull();

    const split = mount(
      createElement(JsonDiffView, {
        before,
        after,
        layout: 'split',
      }),
    );
    expect(split.querySelector('mark[class*="inlineRemoved"]')).not.toBeNull();
    expect(split.querySelector('mark[class*="inlineAdded"]')).not.toBeNull();
  });

  it('uses scalar-array sequence matching for insertions without shifting later items', () => {
    const host = mount(
      tree(
        { traitIds: ['new', 'alpha', 'beta', 'gamma'] },
        { traitIds: ['alpha', 'beta', 'gamma'] },
      ),
    );

    clickButton(host, 'Full');
    expect(rowStatus(host, 'traitIds[0]', 'Added')).not.toBeNull();
    for (const index of [1, 2, 3]) {
      expect(rowStatus(host, `traitIds[${index}]`, 'Added')).toBeNull();
      expect(rowStatus(host, `traitIds[${index}]`, 'Removed')).toBeNull();
      expect(rowStatus(host, `traitIds[${index}]`, 'Changed')).toBeNull();
    }
  });

  it('matches object arrays by unique stable identity for insertions and removals', () => {
    const before = {
      socketEntries: [
        { hash: 10, name: 'first' },
        { hash: 20, name: 'second' },
        { hash: 30, name: 'third' },
      ],
    };
    const after = {
      socketEntries: [
        { hash: 10, name: 'first' },
        { hash: 15, name: 'inserted' },
        { hash: 30, name: 'third' },
      ],
    };
    const host = mount(tree(after, before));

    clickButton(host, 'Full');
    expect(rowStatus(host, 'socketEntries[1]', 'Removed')).not.toBeNull();
    expect(rowStatus(host, 'socketEntries[2]', 'Added')).not.toBeNull();
    expect(rowStatus(host, 'socketEntries[3]', 'Changed')).toBeNull();
  });

  it('renders unnamed resolved references as a short table and hash and filters by hash', () => {
    const unnamed: ResolvedHashSummary = {
      table: 'DestinyPlugSetDefinition',
      hash: 1312,
      name: '',
      subtitle: '',
    };
    const host = mount(
      tree(
        { plugSetHash: 1312 },
        undefined,
        {
          resolvedRefs: { '1312': unnamed },
          initialFilter: '#1312',
        },
      ),
    );

    const pill = host.querySelector('button[aria-label="Open PlugSet #1312"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('PlugSet');
    expect(pill?.textContent).toContain('#1312');
    expect(pill?.textContent).not.toContain('Unnamed');
    expect(pill?.getAttribute('title')).toContain('PlugSet #1312');
    expect(host.querySelector('[data-json-row-path="plugSetHash"]')).not.toBeNull();
  });

  it('offers a clickable lazy pill for an unloaded numeric object-key reference', () => {
    const onNavigateRef = vi.fn();
    const host = mount(
      tree(
        { stats: { '1312': { value: 4 } } },
        undefined,
        { onNavigateRef },
      ),
    );
    const statsRow = host.querySelector('[data-json-row-path="stats"]');
    const toggle = statsRow?.querySelector('button');
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());

    const pill = host.querySelector<HTMLButtonElement>('button[aria-label="Open Stat 1312"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('Open');
    act(() => pill?.click());
    expect(onNavigateRef).toHaveBeenCalledWith(
      { table: 'DestinyStatDefinition', hash: 1312 },
      false,
    );
  });

  it('shows an unnamed resolved object-key pill with its short table and hash', () => {
    const stat: ResolvedHashSummary = {
      table: 'DestinyStatDefinition',
      hash: 1312,
      name: '',
      subtitle: '',
    };
    const host = mount(
      tree(
        { stats: { '1312': { value: 4 } } },
        undefined,
        {
          resolvedRefs: { '1312': stat },
          initialFilter: 'Stat',
        },
      ),
    );

    const pill = host.querySelector<HTMLButtonElement>('button[aria-label="Open Stat #1312"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toContain('Stat');
    expect(pill?.textContent).toContain('#1312');
    expect(pill?.textContent).not.toContain('Unnamed');
  });

  it('has parent-context targets for common generic hash reference objects', () => {
    expect(getTargetTablesForField('hash', 'plug')).toEqual([
      'DestinyInventoryItemDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'socket')).toEqual([
      'DestinySocketTypeDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'perk')).toEqual([
      'DestinySandboxPerkDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'category')).toEqual([
      'DestinyItemCategoryDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'bucket')).toEqual([
      'DestinyInventoryBucketDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'tier')).toEqual([
      'DestinyItemTierTypeDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'unlock')).toEqual([
      'DestinyUnlockDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'powercap')).toEqual([
      'DestinyPowerCapDefinition',
    ]);
    expect(getTargetTablesForField('hash', 'reward')).toEqual([
      'DestinyInventoryItemDefinition',
    ]);
  });
});
