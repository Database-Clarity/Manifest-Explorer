/// <reference types="vite/client" />
import { memo, type ReactNode } from 'react';
import type { ManifestStatus } from '../types/manifest';
import { useExplorerStore } from '../stores/explorer';
import { ClarityWordmark, HeartFilledIcon, KofiIcon } from '../ui/Icons';
import styles from './StatusBar.module.scss';

export interface StatusBarProps {
  onCheckUpdates: () => void;
  onOpenHelp: () => void;
  appUpdateAvailable: boolean;
  onReloadApp: () => void;
  onOpenChangelog?: () => void;
  hasUnseenChangelog?: boolean;
}

type StatusTone = 'ok' | 'busy' | 'error';

interface StatusView {
  label: string;
  tone: StatusTone;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
}

function resolveStatus(phase: ManifestStatus['phase']): StatusView {
  if (phase === 'error') {
    return { label: 'Error', tone: 'error' };
  }
  if (phase === 'fetching-index' || phase === 'loading-core' || phase === 'indexing-secondary') {
    return { label: 'Loading table', tone: 'busy' };
  }
  return { label: 'Ready', tone: 'ok' };
}

export const StatusBar = memo(function StatusBar({
  onCheckUpdates,
  onOpenHelp,
  appUpdateAvailable,
  onReloadApp,
  onOpenChangelog,
  hasUnseenChangelog = false,
}: StatusBarProps): ReactNode {
  const manifestStatus = useExplorerStore((state) => state.manifestStatus);

  const status = resolveStatus(manifestStatus.phase);
  const dotClass =
    status.tone === 'error'
      ? styles.dotError
      : status.tone === 'busy'
        ? styles.dotBusy
        : styles.dotOk;

  const entryLabel = manifestStatus.indexedEntryCount === 1 ? 'entry' : 'entries';
  const versionLabel =
    manifestStatus.version.length > 0 ? manifestStatus.version : 'No manifest loaded';

  return (
    <footer className={styles.statusBar} aria-label="Manifest status">
      <div
        className={styles.status}
        role="status"
        aria-live="polite"
        title={manifestStatus.error ?? status.label}
      >
        <span className={cx(styles.dot, dotClass)} aria-hidden="true" />
        <span className={styles.statusText}>{status.label}</span>
      </div>

      <span className={styles.divider} aria-hidden="true" />

      <div className={cx(styles.versionGroup, styles.secondary)} title={versionLabel}>
        <span className={styles.version}>{versionLabel}</span>
        <span className={styles.locale}>{manifestStatus.locale}</span>
        {manifestStatus.fromCache && <span className={styles.cacheBadge}>cached</span>}
      </div>

      <span className={cx(styles.divider, styles.secondary)} aria-hidden="true" />

      <span
        className={styles.indexed}
        title={`${NUMBER_FORMAT.format(manifestStatus.indexedEntryCount)} indexed ${entryLabel}`}
      >
        {NUMBER_FORMAT.format(manifestStatus.indexedEntryCount)} {entryLabel} ·{' '}
        {manifestStatus.loadedTableCount}/{manifestStatus.totalTableCount} tables
      </span>

      {appUpdateAvailable && (
        <button
          type="button"
          className={styles.updateButton}
          onClick={onReloadApp}
          aria-label="Reload to update Manifest Explorer"
        >
          Update available · Reload
        </button>
      )}

      <div
        className={cx(
          styles.actions,
          appUpdateAvailable && styles.actionsWithUpdate,
        )}
      >
        <button type="button" className={styles.barBtn} onClick={onCheckUpdates}>
          Check updates
        </button>
        {onOpenChangelog && (
          <button
            type="button"
            className={styles.barBtn}
            onClick={onOpenChangelog}
            aria-label={hasUnseenChangelog ? 'What’s new (unread updates)' : 'What’s new'}
            title="What’s new"
          >
            What’s new
            {hasUnseenChangelog && (
              <span className={cx(styles.dot, styles.dotOk)} aria-hidden="true" />
            )}
          </button>
        )}
        <button
          type="button"
          className={styles.barBtn}
          onClick={onOpenHelp}
          aria-label="Keyboard shortcuts and search help"
          title="Keyboard shortcuts and search help"
        >
          Shortcuts (?)
        </button>
        <span className={styles.actionDivider} aria-hidden="true" />
        <span className={styles.credit}>
          <span>Made with</span>
          <HeartFilledIcon size={10} aria-label="love" />
          <span>by</span>
          <a
            className={`${styles.barLink} ${styles.creditLink}`}
            href="https://d2clarity.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Clarity"
            title="Visit Clarity"
          >
            <ClarityWordmark height={12} aria-label="Clarity" />
          </a>
        </span>
        <span className={styles.actionDivider} aria-hidden="true" />
        <a
          className={cx(styles.barLink, styles.kofiButton)}
          href="https://ko-fi.com/D2Clarity"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Support Clarity on Ko-Fi"
          title="Support Clarity on Ko-Fi"
        >
          <KofiIcon size={13} />
          Ko-Fi
        </a>
      </div>
    </footer>
  );
});
