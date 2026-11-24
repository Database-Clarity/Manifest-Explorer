/**
 * Scrolls a horizontally overflowing tab strip just enough to reveal a tab.
 * Avoid scrollIntoView: its default behavior can also move vertical ancestors.
 */
export function scrollTabIntoView(
  container: HTMLElement,
  tab: HTMLElement,
  padding = 8,
): void {
  const containerRect = container.getBoundingClientRect();
  const tabRect = tab.getBoundingClientRect();
  const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);

  if (tabRect.right > containerRect.right) {
    container.scrollLeft = Math.min(
      maxScrollLeft,
      container.scrollLeft + tabRect.right - containerRect.right + padding,
    );
  } else if (tabRect.left < containerRect.left) {
    container.scrollLeft = Math.max(
      0,
      container.scrollLeft - (containerRect.left - tabRect.left + padding),
    );
  }
}
