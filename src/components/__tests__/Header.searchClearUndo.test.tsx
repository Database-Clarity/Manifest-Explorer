/** @vitest-environment jsdom */
import { act, createRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExplorerStore } from '../../stores/explorer';
import { Header } from '../Header';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedView {
  host: HTMLDivElement;
  root: Root;
}

const mounted: MountedView[] = [];

const noop = (): void => {};

function mountHeader(): { host: HTMLDivElement; ref: React.RefObject<HTMLTextAreaElement | null> } {
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

  return { host, ref };
}

function searchField(host: HTMLElement): HTMLTextAreaElement {
  const field = host.querySelector<HTMLTextAreaElement>('textarea');
  if (!field) throw new Error('Header search textarea was not rendered');
  return field;
}

function queryButton(host: HTMLElement, label: string): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const element = queryButton(host, label);
  if (!element) throw new Error(`Button "${label}" was not rendered`);
  return element;
}

/** Writes through the native setter so React's controlled textarea sees the change. */
function type(field: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(field, value);
  act(() => field.dispatchEvent(new Event('input', { bubbles: true })));
}

function pressKey(
  target: HTMLElement,
  key: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {},
): globalThis.KeyboardEvent {
  const event = new globalThis.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

function setQuery(query: string): void {
  act(() => useExplorerStore.getState().setQuery(query));
}

beforeEach(() => {
  setQuery('');
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  for (const { host, root } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
  setQuery('');
  vi.restoreAllMocks();
});

describe('Header search clear keyboard undo', () => {
  it('Clear focuses the field, keeps the / hint, and Ctrl+Z restores the query', () => {
    const { host, ref } = mountHeader();
    const field = searchField(host);

    type(field, 'Dreambane Helm');
    expect(field.value).toBe('Dreambane Helm');
    expect(useExplorerStore.getState().query).toBe('Dreambane Helm');

    act(() => button(host, 'Clear search').click());

    expect(field.value).toBe('');
    expect(useExplorerStore.getState().query).toBe('');
    expect(queryButton(host, 'Clear search')).toBeNull();
    expect(queryButton(host, 'Undo clear search')).toBeNull();
    expect(host.querySelector('kbd')).not.toBeNull();
    expect(document.activeElement).toBe(field);

    const event = pressKey(field, 'z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(field.value).toBe('Dreambane Helm');
    expect(useExplorerStore.getState().query).toBe('Dreambane Helm');
    expect(queryButton(host, 'Undo clear search')).toBeNull();
    expect(ref.current).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe('Dreambane Helm'.length);
  });

  it('Meta+Z also restores the cleared query and caret', () => {
    const { host } = mountHeader();
    const field = searchField(host);

    type(field, 'Dreambane Helm');
    act(() => button(host, 'Clear search').click());
    expect(host.querySelector('kbd')).not.toBeNull();

    const event = pressKey(field, 'Z', { metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(field.value).toBe('Dreambane Helm');
    expect(useExplorerStore.getState().query).toBe('Dreambane Helm');
    expect(field.selectionStart).toBe('Dreambane Helm'.length);
    expect(queryButton(host, 'Undo clear search')).toBeNull();
  });

  it('typing new text invalidates the snapshot', () => {
    const { host } = mountHeader();
    const field = searchField(host);

    type(field, 'Sunshot');
    act(() => button(host, 'Clear search').click());
    type(field, 'Gjallarhorn');

    const event = pressKey(field, 'z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(field.value).toBe('Gjallarhorn');
    expect(useExplorerStore.getState().query).toBe('Gjallarhorn');
  });

  it('manually backspacing to empty does not enable undo', () => {
    const { host } = mountHeader();
    const field = searchField(host);

    type(field, 'Dreambane Helm');
    type(field, '');

    expect(field.value).toBe('');
    const event = pressKey(field, 'z', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(field.value).toBe('');
    expect(host.querySelector('kbd')).not.toBeNull();
  });
});
