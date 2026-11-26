/** @vitest-environment jsdom */
import { act, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClearSearchInput } from '../ClearSearchInput';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedView {
  host: HTMLDivElement;
  root: Root;
}

const mounted: MountedView[] = [];

interface HarnessProps {
  initialValue?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function Harness({ initialValue = '', onKeyDown }: HarnessProps): ReactNode {
  const [value, setValue] = useState(initialValue);
  return (
    <ClearSearchInput
      value={value}
      onValueChange={setValue}
      clearLabel="Clear filter"
      placeholder="Filter"
      onKeyDown={onKeyDown}
    />
  );
}

function mount(node: ReactNode): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ host, root });
  act(() => root.render(node));
  return host;
}

function input(host: HTMLElement): HTMLInputElement {
  const element = host.querySelector<HTMLInputElement>('input');
  if (!element) throw new Error('Search input was not rendered');
  return element;
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`Button "${label}" was not rendered`);
  return element;
}

function anyButton(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>('button');
}

/** Writes through the native setter so React's controlled input sees the change. */
function type(inputElement: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(inputElement, value);
  act(() => inputElement.dispatchEvent(new Event('input', { bubbles: true })));
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

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe('ClearSearchInput keyboard undo', () => {
  it('clicking Clear focuses the field and leaves no inline undo button', () => {
    const host = mount(<Harness initialValue="Dreambane Helm" />);
    const field = input(host);

    act(() => button(host, 'Clear filter').click());

    expect(field.value).toBe('');
    expect(anyButton(host)).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('Ctrl+Z after Clear restores the exact text and caret', () => {
    const host = mount(<Harness initialValue="Dreambane Helm" />);
    const field = input(host);

    act(() => button(host, 'Clear filter').click());
    const event = pressKey(field, 'z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(field.value).toBe('Dreambane Helm');
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe('Dreambane Helm'.length);
    expect(field.selectionEnd).toBe('Dreambane Helm'.length);
  });

  it('Cmd+Z restores on macOS-style shortcuts', () => {
    const host = mount(<Harness initialValue="Sunshot" />);
    const field = input(host);

    act(() => button(host, 'Clear filter').click());
    pressKey(field, 'Z', { metaKey: true });

    expect(field.value).toBe('Sunshot');
    expect(anyButton(host)).not.toBeNull();
    expect(anyButton(host)?.getAttribute('aria-label')).toBe('Clear filter');
  });

  it('typing new text invalidates the undo snapshot', () => {
    const host = mount(<Harness initialValue="Dreambane Helm" />);
    const field = input(host);

    act(() => button(host, 'Clear filter').click());
    type(field, 'Gjallarhorn');

    const event = pressKey(field, 'z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(field.value).toBe('Gjallarhorn');

    // Backspacing the new text away must not resurrect the old snapshot.
    type(field, '');
    expect(field.value).toBe('');
    expect(anyButton(host)).toBeNull();
    expect(pressKey(field, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('manually backspacing to empty never enables undo', () => {
    const host = mount(<Harness initialValue="Dreambane Helm" />);
    const field = input(host);

    type(field, '');

    expect(field.value).toBe('');
    expect(anyButton(host)).toBeNull();
    expect(pressKey(field, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
  });

  it('Ctrl+Z is left untouched when there is no snapshot', () => {
    const host = mount(<Harness initialValue="" />);
    const field = input(host);

    const event = pressKey(field, 'z', { ctrlKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(field.value).toBe('');
  });

  it('passed onKeyDown still runs and can prevent the undo shortcut', () => {
    const onKeyDown = vi.fn((event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'z') event.preventDefault();
    });
    const host = mount(<Harness initialValue="Sunshot" onKeyDown={onKeyDown} />);
    const field = input(host);

    act(() => button(host, 'Clear filter').click());
    pressKey(field, 'z', { ctrlKey: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(field.value).toBe('');
  });
});
