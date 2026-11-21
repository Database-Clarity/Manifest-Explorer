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
      const panelWidth = panel?.offsetWidth ?? rect.width;
      const panelHeight = panel?.offsetHeight ?? 0;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const preferredLeft = align === 'end' ? rect.right - panelWidth : rect.left;
      const maxLeft = Math.max(VIEWPORT_INSET, viewportWidth - panelWidth - VIEWPORT_INSET);
      const left = Math.min(Math.max(preferredLeft, VIEWPORT_INSET), maxLeft);

      const maxTop = Math.max(VIEWPORT_INSET, viewportHeight - panelHeight - VIEWPORT_INSET);
      let top = rect.bottom + ANCHOR_GAP;
      if (top + panelHeight > viewportHeight - VIEWPORT_INSET) {
        const above = rect.top - panelHeight - ANCHOR_GAP;
        top = above >= VIEWPORT_INSET && above <= maxTop ? above : maxTop;
      }
      top = Math.min(Math.max(top, VIEWPORT_INSET), maxTop);

      setPosition({ top, left });
    };

    updatePosition();

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updatePosition) : null;
    if (observer && panelRef.current) {
      observer.observe(panelRef.current);
    }

    const frame = window.requestAnimationFrame(updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
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
