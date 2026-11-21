/// <reference types="vite/client" />
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../ui/Icons';
import styles from './HelpDialog.module.scss';

export interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Focus search'],
  ['Ctrl+K', 'Focus search from anywhere'],
  ['↑/↓', 'Move the result selection'],
  ['Enter', 'Open the selected result'],
  ['Esc', 'Close the inspector, search focus, or a dialog'],
  ['Alt+←/→', 'Step through definition history'],
  ['1–6', 'Switch inspector tab'],
  ['c', 'Copy the current definition hash'],
  ['Shift+C', 'Copy the current definition JSON'],
  ['a', 'Add or remove the current definition from the collector'],
  ['?', 'Open this reference'],
];

const OPERATORS: ReadonlyArray<readonly [string, string]> = [
  ['table:perk', 'Restrict results to one table'],
  ['tier:exotic', 'Filter by item tier'],
  ['damage:solar', 'Filter by damage type'],
  ['class:hunter', 'Filter by guardian class'],
  ['type:weapon', 'Filter by item type'],
  ['cat:shader', 'Match an item category'],
  ['is:adept', 'Only adept items'],
  ['is:redacted', 'Only redacted definitions'],
  ['has:lore', 'Only items with lore'],
  ['-engram', 'Exclude a term'],
  ['1363886209', 'Jump straight to a hash'],
  ['0x514c2131, -1368098261', 'Signed, unsigned, hex, or a pasted list'],
];

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

export function HelpDialog({ open, onClose }: HelpDialogProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const shortcutsId = useId();
  const operatorsId = useId();

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());

    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') {
        // Keep global app shortcuts from firing behind the modal.
        event.stopPropagation();
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            Keyboard &amp; search reference
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeBtn}
            onClick={() => onCloseRef.current()}
            aria-label="Close reference"
            title="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className={styles.content}>
          <section className={styles.column} aria-labelledby={shortcutsId}>
            <h3 id={shortcutsId} className={styles.sectionTitle}>
              Keyboard shortcuts
            </h3>
            <div className={styles.rows}>
              {SHORTCUTS.map(([keys, description]) => (
                <div key={keys} className={styles.row}>
                  <kbd className={styles.kbd}>{keys}</kbd>
                  <span className={styles.rowText}>{description}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.column} aria-labelledby={operatorsId}>
            <h3 id={operatorsId} className={styles.sectionTitle}>
              Search operators
            </h3>
            <div className={styles.rows}>
              {OPERATORS.map(([operator, description]) => (
                <div key={operator} className={cx(styles.row, styles.opRow)}>
                  <code className={styles.op}>{operator}</code>
                  <span className={styles.rowText}>{description}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <p className={styles.footer}>
          Press <kbd className={styles.kbd}>Esc</kbd> to close this reference.
        </p>
      </div>
    </div>,
    document.body,
  );
}
