/// <reference types="vite/client" />
import { useState, type ReactNode, type RefObject } from 'react';
import type { CollectorExportFormat } from '../stores/collector';
import { formatCollectedItems, useCollectorStore, type CollectedItem } from '../stores/collector';
import { useExplorerStore } from '../stores/explorer';
import { bungieAssetUrl } from '../manifest/hash';
import { getShortTableName } from '../manifest/tables';
import { BookmarkIcon, CloseIcon, DownloadIcon } from '../ui/Icons';
import { Popover } from '../ui/Popover';
import styles from './CollectorPopover.module.scss';

export interface CollectorPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}

interface ExportMeta {
  fileName: string;
  mime: string;
}

const EXPORT_OPTIONS: ReadonlyArray<readonly [CollectorExportFormat, string]> = [
  ['json-hashes', 'JSON hashes'],
  ['ts-const', 'TypeScript const'],
  ['csv', 'CSV'],
  ['markdown', 'Markdown'],
  ['grouped-json', 'Grouped JSON'],
];

const EXPORT_META: Readonly<Record<CollectorExportFormat, ExportMeta>> = {
  'json-hashes': { fileName: 'manifest-hashes.json', mime: 'application/json' },
  'ts-const': { fileName: 'collected-items.ts', mime: 'text/plain' },
  csv: { fileName: 'manifest-hashes.csv', mime: 'text/csv' },
  markdown: { fileName: 'manifest-hashes.md', mime: 'text/markdown' },
  'grouped-json': { fileName: 'manifest-hashes-grouped.json', mime: 'application/json' },
};

/**
 * Zero-cost shell: while the popover is closed nothing below mounts, so no
 * collector subscription or item list renders on unrelated renders. `Popover`
 * restores focus to the anchor from its effect cleanup on unmount, so Escape
 * and outside-click closing behave exactly as before.
 */
export function CollectorPopover(props: CollectorPopoverProps): ReactNode {
  if (!props.open) {
    return null;
  }
  return <CollectorPopoverBody {...props} />;
}

function CollectorPopoverBody({ open, onClose, anchorRef }: CollectorPopoverProps): ReactNode {
  const [format, setFormat] = useState<CollectorExportFormat>('json-hashes');

  const collectMode = useCollectorStore((state) => state.collectMode);
  const items = useCollectorStore((state) => state.items);
  const toggleCollectMode = useCollectorStore((state) => state.toggleCollectMode);
  const removeItem = useCollectorStore((state) => state.removeItem);
  const clearAll = useCollectorStore((state) => state.clearAll);

  const openInNewTab = useExplorerStore((state) => state.openInNewTab);
  const pushNotice = useExplorerStore((state) => state.pushNotice);

  function handleInspect(item: CollectedItem): void {
    openInNewTab({
      table: item.table,
      hash: item.hash,
      label: item.name || undefined,
      icon: item.icon,
    });
    onClose();
  }

  async function handleCopy(): Promise<void> {
    if (items.length === 0) {
      pushNotice({ tone: 'warn', message: 'No collected items to copy' });
      return;
    }

    try {
      if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(formatCollectedItems(items, format));
      pushNotice({ tone: 'info', message: `Copied ${items.length} hashes` });
    } catch {
      pushNotice({ tone: 'danger', message: 'Could not copy to the clipboard' });
    }
  }

  function handleDownload(): void {
    if (items.length === 0) {
      pushNotice({ tone: 'warn', message: 'No collected items to download' });
      return;
    }

    const meta = EXPORT_META[format];
    const blob = new Blob([formatCollectedItems(items, format)], {
      type: `${meta.mime};charset=utf-8`,
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = meta.fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    pushNotice({ tone: 'info', message: `Downloaded ${items.length} hashes` });
  }

  function handleClear(): void {
    if (items.length === 0) {
      return;
    }
    clearAll();
    pushNotice({ tone: 'info', message: 'Cleared collected items' });
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="end"
      label="Collector"
      width="21rem"
    >
      <div className={styles.body}>
        <button
          type="button"
          role="switch"
          aria-checked={collectMode}
          className={styles.switchRow}
          onClick={toggleCollectMode}
        >
          <span className={styles.switchLabel}>Collect mode (click results to add)</span>
          <span
            className={`${styles.switch} ${collectMode ? styles.switchOn : ''}`}
            aria-hidden="true"
          >
            <span className={styles.knob} />
          </span>
        </button>

        {items.length > 0 ? (
          <div className={styles.list}>
            {items.map((item) => (
              <div key={`${item.table}:${item.hash}`} className={styles.item}>
                <button
                  type="button"
                  className={styles.itemMain}
                  onClick={() => handleInspect(item)}
                  title={`Inspect ${item.name.length > 0 ? item.name : 'unnamed definition'}`}
                >
                  <span className={styles.itemIcon} aria-hidden="true">
                    {item.icon !== undefined && item.icon.length > 0 ? (
                      <img src={bungieAssetUrl(item.icon)} alt="" loading="lazy" />
                    ) : (
                      <BookmarkIcon size={13} />
                    )}
                  </span>
                  <span className={styles.itemText}>
                    <span className={styles.itemName}>{item.name.length > 0 ? item.name : 'Unnamed'}</span>
                    <span className={styles.itemMeta}>
                      {getShortTableName(item.table)} · {item.hash}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => removeItem(item.table, item.hash)}
                  aria-label={`Remove ${item.name.length > 0 ? item.name : 'unnamed definition'}`}
                  title="Remove"
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No collected items yet. Turn on collect mode, then click results.</p>
        )}

        <div className={styles.exportRow}>
          <label className={styles.exportLabel} htmlFor="collector-export-format">
            Export format
          </label>
          <select
            id="collector-export-format"
            className={styles.exportSelect}
            value={format}
            onChange={(event) => setFormat(event.target.value as CollectorExportFormat)}
          >
            {EXPORT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => {
              void handleCopy();
            }}
          >
            Copy export
          </button>
          <button type="button" className={styles.actionBtn} onClick={handleDownload}>
            <DownloadIcon size={12} />
            Download
          </button>
          <button type="button" className={styles.clearBtn} onClick={handleClear}>
            Clear
          </button>
        </div>
      </div>
    </Popover>
  );
}
