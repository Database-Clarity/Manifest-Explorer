import type { MouseEvent } from 'react';

/**
 * Windows browsers start the middle-click autoscroll pan cursor on `mousedown`
 * (`button === 1`), which swallows the gesture before `auxclick` fires inside
 * scrollable panes. Preventing the mousedown default keeps middle-click free
 * for our own new-tab actions.
 */
export function preventMiddleClickAutoScroll(event: MouseEvent<HTMLElement>): void {
  if (event.button === 1) {
    event.preventDefault();
  }
}

/**
 * Runs a new-tab style action for a middle-click. The handler is shared by
 * buttons, cards and rows so every entry behaves the same: no browser
 * autoscroll and no duplicate activation from an outer clickable container.
 */
export function activateOnMiddleClick(
  event: MouseEvent<HTMLElement>,
  activate: () => void,
): void {
  if (event.button !== 1) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  activate();
}
