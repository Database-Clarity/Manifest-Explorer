export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The visible viewport in layout-viewport coordinates. */
export interface PlacementArea {
  top: number;
  bottom: number;
  left?: number;
  width: number;
  layoutHeight: number;
  edge: number;
}

export interface Placement {
  side: 'below' | 'above';
  left: number;
  width: number;
  maxHeight: number;
  top: number | 'auto';
  bottom: number | 'auto';
}

/**
 * Place a popup alongside its trigger, flipping above only when the popup will
 * not fit below and there is more room above. Coordinates are suitable for a
 * fixed-position element.
 */
export function placeAnchored({
  trigger,
  area,
  width,
  height = 0,
  gap = 2,
  align = 'start',
}: {
  trigger: TriggerRect;
  area: PlacementArea;
  width: number;
  height?: number;
  gap?: number;
  align?: 'start' | 'end';
}): Placement {
  const areaLeft = area.left ?? 0;
  const fit = Math.max(0, Math.min(width, area.width - area.edge * 2));
  const wanted = align === 'end' ? trigger.right - fit : trigger.left;
  const minLeft = areaLeft + area.edge;
  const maxLeft = Math.max(minLeft, areaLeft + area.width - fit - area.edge);
  const left = Math.max(minLeft, Math.min(wanted, maxLeft));

  const belowTop = Math.max(area.top, Math.min(trigger.bottom + gap, area.bottom));
  const aboveBottom = Math.max(area.top, Math.min(trigger.top - gap, area.bottom));
  const below = Math.max(0, area.bottom - belowTop);
  const above = Math.max(0, aboveBottom - area.top);

  if (height <= below || below >= above) {
    return {
      side: 'below',
      left,
      width: fit,
      maxHeight: below,
      top: belowTop,
      bottom: 'auto',
    };
  }

  return {
    side: 'above',
    left,
    width: fit,
    maxHeight: above,
    top: 'auto',
    bottom: area.layoutHeight - aboveBottom,
  };
}

/** Read the currently visible area, including mobile keyboard and viewport panning. */
export function visibleArea(win: Window = window): PlacementArea {
  const visualViewport = win.visualViewport;
  const layoutHeight = win.innerHeight;
  const root = win.document.documentElement;
  const layoutWidth = [win.innerWidth, root.clientWidth, root.offsetWidth].filter(
    (value) => value > 0,
  );
  const fullWidth = layoutWidth.length ? Math.min(...layoutWidth) : win.innerWidth;
  const visualLeft = Math.max(0, visualViewport?.offsetLeft ?? 0);
  const visualRight = Math.min(
    fullWidth,
    visualLeft + (visualViewport?.width ?? fullWidth),
  );
  const visualTop = Math.max(0, visualViewport?.offsetTop ?? 0);
  const visualBottom = Math.min(
    layoutHeight,
    visualTop + (visualViewport?.height ?? layoutHeight),
  );

  return {
    top: visualTop + 8,
    bottom: visualBottom - 8,
    left: visualLeft,
    width: Math.max(0, visualRight - visualLeft),
    layoutHeight,
    edge: 8,
  };
}

/** Apply a calculated placement directly to a fixed-position element. */
export function applyPlacement(element: HTMLElement, placement: Placement): void {
  const px = (value: number | 'auto') => (value === 'auto' ? 'auto' : `${value}px`);
  Object.assign(element.style, {
    left: `${placement.left}px`,
    width: `${placement.width}px`,
    maxHeight: `${placement.maxHeight}px`,
    top: px(placement.top),
    bottom: px(placement.bottom),
  });
}

/** Recalculate at most once per animation frame as the anchor or viewport moves. */
export function followPlacement(
  surface: () => Element | null,
  place: () => void,
): () => void {
  let frame: number | null = null;
  let timer: number | null = null;
  const run = () => {
    frame = null;
    timer = null;
    place();
  };
  const schedule = (event?: Event) => {
    const element = surface();
    if (event?.target instanceof Node && element?.contains(event.target)) return;
    if (frame !== null || timer !== null) return;
    if (typeof window.requestAnimationFrame === 'function') {
      frame = window.requestAnimationFrame(run);
    } else {
      timer = window.setTimeout(run, 16);
    }
  };
  const visualViewport = window.visualViewport;

  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  visualViewport?.addEventListener('resize', schedule);
  visualViewport?.addEventListener('scroll', schedule);

  return () => {
    window.removeEventListener('resize', schedule);
    window.removeEventListener('scroll', schedule, true);
    visualViewport?.removeEventListener('resize', schedule);
    visualViewport?.removeEventListener('scroll', schedule);
    if (frame !== null) window.cancelAnimationFrame(frame);
    if (timer !== null) window.clearTimeout(timer);
  };
}
