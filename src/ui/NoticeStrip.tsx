/// <reference types="vite/client" />
import type { ReactNode } from 'react';
import { CloseIcon } from './Icons';
import { useExplorerStore, type NoticeTone } from '../stores/explorer';
import styles from './NoticeStrip.module.scss';

function toneClass(tone: NoticeTone): string {
  if (tone === 'warn') {
    return styles.warn ?? '';
  }
  if (tone === 'danger') {
    return styles.danger ?? '';
  }
  return styles.info ?? '';
}

export function NoticeStrip(): ReactNode {
  const notices = useExplorerStore((state) => state.notices);
  const dismissNotice = useExplorerStore((state) => state.dismissNotice);

  if (notices.length === 0) {
    return null;
  }

  return (
    <div className={styles.container} aria-live="polite" aria-atomic="false">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={`${styles.notice ?? ''} ${toneClass(notice.tone)}`}
          role={notice.tone === 'danger' ? 'alert' : 'status'}
        >
          <p className={styles.message}>{notice.message}</p>
          <div className={styles.actions}>
            {notice.actionLabel ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  notice.onAction?.();
                  dismissNotice(notice.id);
                }}
              >
                {notice.actionLabel}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.dismiss}
              aria-label="Dismiss notice"
              onClick={() => dismissNotice(notice.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
