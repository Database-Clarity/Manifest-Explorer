import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChangelogEntry } from '../data/changelog';
import { ChevronDownIcon, CloseIcon, ExternalLinkIcon, HeartIcon, ManifestMark } from '../ui/Icons';
import styles from './ChangelogDialog.module.scss';

export interface ChangelogDialogProps {
  open: boolean;
  onClose: () => void;
  entries: readonly ChangelogEntry[];
  expandedVersions: readonly string[];
  unseenVersions: readonly string[];
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ChangelogDialog({
  open,
  onClose,
  entries,
  expandedVersions,
  unseenVersions,
}: ChangelogDialogProps): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

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
        event.stopPropagation();
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

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

  if (!open) return null;

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
          <div className={styles.heading}>
            <span className={styles.eyebrow}>
              <ManifestMark size={18} />
              <span>Clarity · Manifest Explorer</span>
            </span>
            <h2 id={titleId} className={styles.title}>
              What’s new
            </h2>
          </div>
          <div className={styles.headerLinks}>
            <a
              className={styles.headerLink}
              href="https://d2clarity.com"
              target="_blank"
              rel="noopener noreferrer"
              title="Visit the Clarity website"
            >
              <span>d2clarity.com</span>
              <ExternalLinkIcon size={10} className={styles.headerLinkIcon} />
            </a>
            <a
              className={`${styles.headerLink} ${styles.kofiLink}`}
              href="https://ko-fi.com/D2Clarity"
              target="_blank"
              rel="noopener noreferrer"
              title="Support Clarity on Ko-Fi"
            >
              <HeartIcon size={11} className={styles.headerLinkIcon} />
              <span>Support on Ko-Fi</span>
            </a>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.closeBtn}
            onClick={() => onCloseRef.current()}
            aria-label="Close changelog"
            title="Close"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.releaseList}>
            {entries.map((entry) => {
              const isUnseen = unseenVersions.includes(entry.version);
              return (
                <details
                  key={entry.version}
                  className={styles.release}
                  open={expandedVersions.includes(entry.version)}
                >
                  <summary className={styles.releaseSummary}>
                    <ChevronDownIcon size={14} className={styles.chevron} />
                    <span className={styles.releaseTitle}>{entry.title}</span>
                    <span className={styles.date}>{entry.date}</span>
                    <span className={styles.version}>{entry.version}</span>
                    {isUnseen && <span className={styles.newBadge}>New</span>}
                  </summary>
                  <div className={styles.releaseBody}>
                    <p className={styles.summary}>{entry.summary}</p>
                    {entry.sections.map((section) => (
                      <section key={section.heading} className={styles.section}>
                        <h3 className={styles.sectionTitle}>{section.heading}</h3>
                        <ul className={styles.items}>
                          {section.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        </div>

        <div className={styles.footer}>
          <p className={styles.footerNote}>
            Reopen anytime from What’s new in the bottom bar or Settings.
          </p>
          <button type="button" className={styles.doneButton} onClick={() => onCloseRef.current()}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
