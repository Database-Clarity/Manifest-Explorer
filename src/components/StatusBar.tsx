/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import type { ManifestStatus } from '../types/manifest';
import { useExplorerStore } from '../stores/explorer';
import styles from './StatusBar.module.scss';

export interface StatusBarProps {
  onCheckUpdates: () => void;
  onOpenHelp: () => void;
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

export function StatusBar({ onCheckUpdates, onOpenHelp }: StatusBarProps): ReactNode {
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

      <div className={styles.actions}>
        <button type="button" className={styles.barBtn} onClick={onCheckUpdates}>
          Check updates
        </button>
        <button
          type="button"
          className={styles.barBtn}
          onClick={onOpenHelp}
          aria-label="Keyboard shortcuts and search help"
          title="Keyboard shortcuts and search help"
        >
          Shortcuts (?)
        </button>
      </div>
    </footer>
  );
}
