/** @vitest-environment jsdom */
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExplorerStore } from '../../stores/explorer';
import { useSearchHistoryStore } from '../../stores/searchHistory';
import { Header } from '../Header';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedView {
  host: HTMLDivElement;
  root: Root;
}

const mounted: MountedView[] = [];
const noop = (): void => {};
const scope = { table: 'all', deepSearch: false };

function mountHeader(): { host: HTMLDivElement; field: HTMLTextAreaElement } {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  const ref = createRef<HTMLTextAreaElement>();

  act(() =>
    root.render(
      (
        <Header
          searchInputRef={ref}
          onCheckUpdates={noop}
          onClearCache={noop}
          onLoadAllTables={noop}
          onOpenHelp={noop}
          onLocaleChange={noop}
          onSelectTable={noop}
          diffCount={0}
          diffTabOpen={false}
          onOpenDiff={noop}
        />
      ) as ReactNode,
    ),
  );

  const field = host.querySelector<HTMLTextAreaElement>('textarea');
  if (!field) throw new Error('Header search textarea was not rendered');
  return { host, field };
}

function type(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(field, value);
  act(() => field.dispatchEvent(new Event('input', { bubbles: true })));
}

function pressKey(
  target: HTMLElement,
  key: string,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  useSearchHistoryStore.getState().clearAll();
  useExplorerStore.getState().setQuery('');
  useExplorerStore.getState().setTableFilter('all');
  useExplorerStore.getState().setDeepSearch(false);
});

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  useSearchHistoryStore.getState().clearAll();
  useExplorerStore.getState().setQuery('');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Header search history menu', () => {
  it('opens on empty focus with up to four saved and six recent rows', () => {
    const history = useSearchHistoryStore.getState();
    for (let index = 0; index < 6; index += 1) {
      history.saveQuery(`Saved search ${index}`, scope, 100 + index);
    }
    for (let index = 0; index < 8; index += 1) {
      history.recordSearch(`Recent search ${index}`, scope, 'enter', 200 + index);
    }

    const { host, field } = mountHeader();
    act(() => field.focus());

    const options = [...host.querySelectorAll<HTMLElement>('[role="option"]')];
    expect(options).toHaveLength(12);
    expect(host.textContent).toContain('Saved');
    expect(host.textContent).toContain('Recent');
    expect(options.some((option) => option.textContent?.includes('Search history…'))).toBe(true);
    expect(options.some((option) => option.textContent?.includes('Saved search 5'))).toBe(true);
    expect(options.some((option) => option.textContent?.includes('Saved search 0'))).toBe(false);
    expect(options.some((option) => option.textContent?.includes('Recent search 7'))).toBe(true);
    expect(options.some((option) => option.textContent?.includes('Recent search 1'))).toBe(false);
    expect(options.every((option) => option.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('opts out of Grammarly and browser spellcheck on the textarea', () => {
    const { field } = mountHeader();

    expect(field.getAttribute('data-gramm')).toBe('false');
    expect(field.getAttribute('data-enable-grammarly')).toBe('false');
    expect(field.getAttribute('spellcheck')).toBe('false');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('autocorrect')).toBe('off');
    expect(field.getAttribute('autocapitalize')).toBe('none');
    expect(field.getAttribute('data-gramm_editor')).toBe('false');
    expect(field.getAttribute('data-lt-active')).toBe('false');
  });

  it('toggles the current query saved state from the star button', () => {
    const { host, field } = mountHeader();
    type(field, 'Sunshot search');

    const saveButton = host.querySelector<HTMLButtonElement>('button[aria-label="Save search"]');
    expect(saveButton?.getAttribute('aria-pressed')).toBe('false');
    act(() => saveButton?.click());
    expect(
      host.querySelector<HTMLButtonElement>('button[aria-label="Saved search — click to unsave"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(useSearchHistoryStore.getState().entries[0]?.saved).toBe(true);
  });

  it('does not run a highlighted history row on Tab, but Enter runs it and restores scope', () => {
    const entryScope = { table: 'InventoryItem', deepSearch: true };
    useSearchHistoryStore.getState().recordSearch('Stasis sword', entryScope, 'menu', 1);
    const { host, field } = mountHeader();
    act(() => field.focus());
    pressKey(field, 'ArrowDown');

    const tab = pressKey(field, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(useExplorerStore.getState().query).toBe('');

    pressKey(field, 'Enter');
    expect(useExplorerStore.getState().query).toBe('Stasis sword');
    expect(useExplorerStore.getState().filters.table).toBe('InventoryItem');
    expect(useExplorerStore.getState().deepSearch).toBe(true);
    expect(useSearchHistoryStore.getState().entries[0]?.lastSource).toBe('menu');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('records only on Enter, blur, and the 2.5 second idle boundary', () => {
    vi.useFakeTimers();
    const searchStore = useSearchHistoryStore.getState();
    const record = vi.spyOn(searchStore, 'recordSearch');
    const { field } = mountHeader();

    act(() => field.focus());
    type(field, 'Dreambane Helm');
    expect(record).not.toHaveBeenCalled();
    pressKey(field, 'Enter');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[2]).toBe('enter');

    record.mockClear();
    type(field, 'Gjallarhorn');
    act(() => vi.advanceTimersByTime(2499));
    expect(record).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[2]).toBe('idle');

    record.mockClear();
    type(field, 'Thorn exotic');
    act(() => field.blur());
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[2]).toBe('blur');
  });
});
