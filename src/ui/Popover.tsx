/// <reference types="vite/client" />
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Popover.module.scss';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element the panel is anchored to. Focus returns here when the panel closes. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Align the panel's start or end edge with the anchor. */
  align?: 'start' | 'end';
  /** Accessible name for the dialog surface. */
  label: string;
  /** Optional fixed width, for example `18rem`. Clamped to the viewport. */
  width?: string;
  children: ReactNode;
}

interface Position {
  top: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
}

const VIEWPORT_INSET = 8;
const ANCHOR_GAP = 6;

export function Popover({
  open,
  onClose,
  anchorRef,
  align = 'start',
  label,
  width,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState<Position | null>(null);

  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const updatePosition = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }

      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      // visualViewport tracks the actually visible area above the mobile
      // keyboard (and any pinch-zoom pan), where innerHeight does not.
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportWidth = visualViewport?.width ?? window.innerWidth;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const maxWidth = Math.max(0, viewportWidth - VIEWPORT_INSET * 2);
      const maxHeight = Math.max(0, viewportHeight - VIEWPORT_INSET * 2);
      const panelWidth = Math.min(panel?.offsetWidth ?? rect.width, maxWidth);
      const panelHeight = Math.min(panel?.offsetHeight ?? 0, maxHeight);

      const minLeft = viewportLeft + VIEWPORT_INSET;
      const maxLeft = Math.max(
        minLeft,
        viewportLeft + viewportWidth - panelWidth - VIEWPORT_INSET,
      );
      const preferredLeft = align === 'end' ? rect.right - panelWidth : rect.left;
      const left = Math.min(Math.max(preferredLeft, minLeft), maxLeft);

      const minTop = viewportTop + VIEWPORT_INSET;
      const maxTop = Math.max(
        minTop,
        viewportTop + viewportHeight - panelHeight - VIEWPORT_INSET,
      );
      let top = rect.bottom + ANCHOR_GAP;
      if (top + panelHeight > viewportTop + viewportHeight - VIEWPORT_INSET) {
        const above = rect.top - panelHeight - ANCHOR_GAP;
        top = above >= minTop && above <= maxTop ? above : maxTop;
      }
      top = Math.min(Math.max(top, minTop), maxTop);

      setPosition({ top, left, maxHeight, maxWidth });
    };

    updatePosition();

    const visualViewport = window.visualViewport;
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    visualViewport?.addEventListener('resize', updatePosition);
    visualViewport?.addEventListener('scroll', updatePosition);

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePosition) : null;
    if (observer && panelRef.current) {
      observer.observe(panelRef.current);
    }

    const frame = window.requestAnimationFrame(updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      visualViewport?.removeEventListener('resize', updatePosition);
      visualViewport?.removeEventListener('scroll', updatePosition);
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [open, align, anchorRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (panelRef.current?.contains(target)) {
        return;
      }
      if (anchorRef.current?.contains(target)) {
        return;
      }
      onCloseRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) {
      return;
    }

    return () => {
      const anchor = anchorRef.current;
      if (anchor?.isConnected) {
        anchor.focus({ preventScroll: true });
      }
    };
  }, [open, anchorRef]);

  if (!open) {
    return null;
  }

  const panelStyle: CSSProperties = {
    top: position?.top ?? 0,
    left: position?.left ?? 0,
    width,
    maxHeight: position?.maxHeight,
    maxWidth: position?.maxWidth,
    visibility: position ? 'visible' : 'hidden',
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      className={styles.panel}
      style={panelStyle}
      data-popover="true"
    >
      {children}
    </div>,
    document.body,
  );
}
