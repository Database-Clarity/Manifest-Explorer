/** @vitest-environment jsdom */
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Popover } from '../Popover';
import { Select, type SelectOption } from '../Select';

const choices: readonly SelectOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'bravo', label: 'Bravo' },
  { value: 'charlie', label: 'Charlie' },
  { value: 'delta', label: 'Delta' },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderSelect(props: Partial<ComponentProps<typeof Select>> = {}) {
  if (!root) throw new Error('Test root was not created');
  const mergedProps: ComponentProps<typeof Select> = {
    value: 'alpha',
    options: choices,
    onChange: () => {},
    ...props,
  };
  act(() => {
    root?.render(<Select {...mergedProps} />);
  });
}

function trigger(): HTMLButtonElement {
  const element = host?.querySelector<HTMLButtonElement>('[data-select-trigger]');
  if (!element) throw new Error('Select trigger was not rendered');
  return element;
}

function popup(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-select-popup]');
  if (!element) throw new Error('Select popup is not open');
  return element;
}

function dispatchKey(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}

function activeLabel(): string | null {
  const activeId =
    trigger().getAttribute('aria-activedescendant') ??
    document.querySelector<HTMLInputElement>('[data-select-search]')?.getAttribute(
      'aria-activedescendant',
    );
  return activeId ? document.getElementById(activeId)?.textContent ?? null : null;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  act(() => {
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn(() => 1),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  document.querySelectorAll('[data-select-popup], [data-popover]').forEach((node) => node.remove());
  vi.restoreAllMocks();
});

describe('Select', () => {
  it('opens and closes by click, and selects an option', () => {
    const onChange = vi.fn();
    renderSelect({ onChange });

    act(() => trigger().click());
    expect(popup()).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');

    const bravo = popup().querySelector<HTMLElement>('[data-value="bravo"]');
    expect(bravo).not.toBeNull();
    act(() => bravo?.click());

    expect(onChange).toHaveBeenCalledWith('bravo');
    expect(document.querySelector('[data-select-popup]')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens with ArrowDown, moves and selects with Enter, and closes with Escape', () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    trigger().focus();

    dispatchKey(trigger(), 'ArrowDown');
    expect(activeLabel()).toBe('Alpha');
    dispatchKey(trigger(), 'ArrowDown');
    expect(activeLabel()).toBe('Bravo');
    dispatchKey(trigger(), 'Enter');

    expect(onChange).toHaveBeenCalledWith('bravo');
    expect(document.querySelector('[data-select-popup]')).toBeNull();

    dispatchKey(trigger(), 'ArrowDown');
    const escape = dispatchKey(trigger(), 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(document.querySelector('[data-select-popup]')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('closes on Tab without selecting or preventing normal tab movement', () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    act(() => trigger().click());

    const tab = dispatchKey(trigger(), 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector('[data-select-popup]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports Home, End, PageDown and PageUp navigation', () => {
    const manyOptions = Array.from({ length: 15 }, (_, index) => ({
      value: `item-${index}`,
      label: `Item ${index}`,
    }));
    renderSelect({
      value: 'item-0',
      options: manyOptions,
    });
    trigger().focus();
    dispatchKey(trigger(), 'ArrowDown');

    dispatchKey(trigger(), 'End');
    expect(activeLabel()).toBe('Item 14');
    dispatchKey(trigger(), 'Home');
    expect(activeLabel()).toBe('Item 0');
    dispatchKey(trigger(), 'PageDown');
    expect(activeLabel()).toBe('Item 10');
    dispatchKey(trigger(), 'PageUp');
    expect(activeLabel()).toBe('Item 0');
  });

  it('supports printable typeahead and cycles repeated letters', () => {
    const options: readonly SelectOption[] = [
      { value: 'alpha', label: 'Alpha' },
      { value: 'alpine', label: 'Alpine' },
      { value: 'bravo', label: 'Bravo' },
    ];
    renderSelect({ value: 'bravo', options });
    trigger().focus();

    dispatchKey(trigger(), 'b');
    expect(activeLabel()).toBe('Bravo');
    dispatchKey(trigger(), 'Escape');
    dispatchKey(trigger(), 'a');
    expect(activeLabel()).toBe('Alpha');
    dispatchKey(trigger(), 'a');
    expect(activeLabel()).toBe('Alpine');
  });

  it('renders grouped sections with accessible group labels', () => {
    renderSelect({
      options: [],
      groups: [
        { label: 'Primary', options: choices.slice(0, 2) },
        { label: 'Secondary', options: choices.slice(2) },
      ],
    });
    act(() => trigger().click());

    const groups = popup().querySelectorAll('[role="group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.getAttribute('aria-labelledby')).toContain('group-0');
    expect(popup().textContent).toContain('Primary');
    expect(popup().textContent).toContain('Secondary');
  });

  it('supports ordered mixed flat and grouped sections', () => {
    renderSelect({
      sections: [
        { options: choices.slice(0, 1) },
        { label: 'More', options: choices.slice(1) },
      ],
    });
    act(() => trigger().click());

    expect(popup().querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(popup().querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(popup().textContent?.indexOf('Alpha')).toBeLessThan(
      popup().textContent?.indexOf('More') ?? -1,
    );
  });

  it('searches labels and keywords, then chooses a filtered match', () => {
    const onChange = vi.fn();
    const options: readonly SelectOption[] = [
      { value: 'stable', label: 'Stable build', keywords: 'v1.4.2' },
      { value: 'beta', label: 'Preview build', keywords: 'v2.0-beta' },
    ];
    renderSelect({
      value: 'stable',
      options,
      searchable: true,
      onChange,
    });
    act(() => trigger().click());

    const input = popup().querySelector<HTMLInputElement>('[data-select-search]');
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    if (!input) throw new Error('Search field was not rendered');
    setInputValue(input, 'beta');

    expect(popup().querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(popup().textContent).toContain('Preview build');
    expect(activeLabel()).toBe('Preview build');
    expect(trigger().querySelector('span')?.textContent).toBe('Stable build');
    dispatchKey(input, 'Enter');

    expect(onChange).toHaveBeenCalledWith('beta');
    renderSelect({
      value: 'beta',
      options,
      searchable: true,
      onChange,
    });
    expect(trigger().querySelector('span')?.textContent).toBe('Preview build');
    expect(trigger().title).toBe('Preview build');
    expect(document.querySelector('[data-select-popup]')).toBeNull();
  });

  it('shows an empty search state and enables search automatically at 321 options', () => {
    const options = Array.from({ length: 321 }, (_, index) => ({
      value: `item-${index}`,
      label: `Option ${index}`,
    }));
    renderSelect({ value: 'item-0', options });
    act(() => trigger().click());

    const input = popup().querySelector<HTMLInputElement>('[data-select-search]');
    expect(input).not.toBeNull();
    if (!input) throw new Error('Search field was not rendered');
    setInputValue(input, 'does not exist');
    expect(popup().querySelector('[role="status"]')?.textContent).toBe('No matching options');
    expect(popup().querySelectorAll('[role="option"]')).toHaveLength(0);
  });

  it('closes when the pointer goes outside the trigger and popup', () => {
    renderSelect();
    act(() => trigger().click());

    const outside = document.createElement('button');
    document.body.append(outside);
    act(() => {
      outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(document.querySelector('[data-select-popup]')).toBeNull();
    outside.remove();
  });

  it('does not dismiss a parent Popover when interacting with its portalled Select', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const anchorRef = { current: anchor };
    const onClose = vi.fn();
    const onChange = vi.fn();
    act(() => {
      root?.render(
        <Popover open onClose={onClose} anchorRef={anchorRef} label="Settings">
          <Select value="alpha" options={choices} onChange={onChange} />
        </Popover>,
      );
    });
    const parentTrigger = document.querySelector<HTMLButtonElement>('[data-select-trigger]');
    expect(parentTrigger).not.toBeNull();
    act(() => parentTrigger?.click());

    const bravo = document.querySelector<HTMLElement>('[data-select-popup] [data-value="bravo"]');
    expect(bravo).not.toBeNull();
    act(() => {
      bravo?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      bravo?.click();
    });
    expect(onChange).toHaveBeenCalledWith('bravo');
    expect(onClose).not.toHaveBeenCalled();

    act(() => parentTrigger?.click());
    if (!parentTrigger) throw new Error('Select trigger was not rendered');
    dispatchKey(parentTrigger, 'Escape');
    expect(document.querySelector('[data-select-popup]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    anchor.remove();
  });
});
