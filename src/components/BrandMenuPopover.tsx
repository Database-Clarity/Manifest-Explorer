/// <reference types="vite/client" />
import type { ReactNode, RefObject } from 'react';
import { useCollectorStore } from '../stores/collector';
import {
  BookmarkIcon,
  ClarityWordmark,
  DatabaseIcon,
  HeartFilledIcon,
  HelpIcon,
  KofiIcon,
  ListIcon,
  ManifestMark,
} from '../ui/Icons';
import { Popover } from '../ui/Popover';
import styles from './BrandMenuPopover.module.scss';

export interface BrandMenuPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  activePage: 'explorer' | 'history';
  onNavigatePage?: (path: '/' | '/history') => void;
  onNavigateExplorer: () => void;
  onOpenCollector: () => void;
  onOpenHelp: () => void;
  onOpenChangelog?: () => void;
  hasUnseenChangelog: boolean;
}

/**
 * Zero-cost shell: the menu and collector subscription are mounted only while
 * the brand menu is open.
 */
export function BrandMenuPopover(props: BrandMenuPopoverProps): ReactNode {
  if (!props.open) {
    return null;
  }

  return <BrandMenuPopoverBody {...props} />;
}

function BrandMenuPopoverBody({
  open,
  onClose,
  anchorRef,
  activePage,
  onNavigatePage,
  onNavigateExplorer,
  onOpenCollector,
  onOpenHelp,
  onOpenChangelog,
  hasUnseenChangelog,
}: BrandMenuPopoverProps): ReactNode {
  const collectedCount = useCollectorStore((state) => state.items.length);
  const collectMode = useCollectorStore((state) => state.collectMode);

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="start"
      width="15.5rem"
      label="Navigation and links"
    >
      <div className={styles.body}>
        <section className={styles.section} aria-label="Navigation">
          <h2 className={styles.sectionTitle}>Navigation</h2>
          <button
            type="button"
            className={`${styles.menuItem} ${activePage === 'explorer' ? styles.menuItemActive : ''}`}
            aria-current={activePage === 'explorer' ? 'page' : undefined}
            onClick={() => {
              onClose();
              onNavigateExplorer();
            }}
          >
            <ManifestMark size={15} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Manifest Explorer</span>
            {activePage === 'explorer' && <span className={styles.activeIndicator}>Current</span>}
          </button>
          <button
            type="button"
            className={`${styles.menuItem} ${activePage === 'history' ? styles.menuItemActive : ''}`}
            aria-current={activePage === 'history' ? 'page' : undefined}
            onClick={() => {
              onClose();
              onNavigatePage?.('/history');
            }}
          >
            <DatabaseIcon size={15} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Manifest History</span>
            {activePage === 'history' && <span className={styles.activeIndicator}>Current</span>}
          </button>
        </section>

        <section className={styles.section} aria-label="Tools">
          <h2 className={styles.sectionTitle}>Tools</h2>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              onClose();
              onOpenCollector();
            }}
          >
            <BookmarkIcon size={15} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Collected items</span>
            {(collectedCount > 0 || collectMode) && (
              <span className={styles.badge}>
                {collectedCount > 0 ? collectedCount : 'Active'}
              </span>
            )}
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              onClose();
              onOpenHelp();
            }}
          >
            <HelpIcon size={15} className={styles.itemIcon} />
            <span className={styles.itemLabel}>Search help &amp; shortcuts</span>
          </button>
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              if (!onOpenChangelog) return;
              onClose();
              onOpenChangelog();
            }}
            disabled={!onOpenChangelog}
          >
            <ListIcon size={15} className={styles.itemIcon} />
            <span className={styles.itemLabel}>What’s new</span>
            {hasUnseenChangelog && <span className={styles.badge}>New</span>}
          </button>
        </section>

        <footer className={styles.footer}>
          <a
            className={styles.creditLink}
            href="https://d2clarity.com"
            target="_blank"
            rel="noopener noreferrer"
            title="Visit Clarity"
          >
            <span>Made with</span>
            <HeartFilledIcon size={12} aria-label="love" />
            <span>by</span>
            <ClarityWordmark height={16} aria-label="Clarity" />
          </a>
          <a
            className={styles.kofiButton}
            href="https://ko-fi.com/D2Clarity"
            target="_blank"
            rel="noopener noreferrer"
          >
            <KofiIcon size={15} />
            Support on Ko-Fi
          </a>
        </footer>
      </div>
    </Popover>
  );
}
