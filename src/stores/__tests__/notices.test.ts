/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIFF_BUCKET_NOTICE_ID } from '../diffBucket';
import { MAX_VISIBLE_NOTICES, useExplorerStore } from '../explorer';

function dismissVisibleNotices(): void {
  for (const notice of useExplorerStore.getState().notices) {
    useExplorerStore.getState().dismissNotice(notice.id);
  }
  useExplorerStore.setState({ notices: [] });
}

beforeEach(() => {
  vi.useRealTimers();
  dismissVisibleNotices();
});

afterEach(() => {
  dismissVisibleNotices();
  vi.useRealTimers();
});

describe('Notice queue', () => {
  it('caps visible notices and clears timers for evicted entries', () => {
    expect(MAX_VISIBLE_NOTICES).toBe(2);
    vi.useFakeTimers();

    for (let index = 1; index <= 5; index += 1) {
      useExplorerStore.getState().pushNotice({
        tone: 'info',
        message: `Notice ${index}`,
      });
    }

    const notices = useExplorerStore.getState().notices;
    expect(notices).toHaveLength(MAX_VISIBLE_NOTICES);
    expect(notices.map((notice) => notice.message)).toEqual([
      'Notice 4',
      'Notice 5',
    ]);

    // Only the two visible notices may keep live auto-dismiss timers; every
    // evicted notice's timer is cleared so nothing leaks or fires later.
    expect(vi.getTimerCount()).toBe(MAX_VISIBLE_NOTICES);

    vi.advanceTimersByTime(4000);
    expect(useExplorerStore.getState().notices).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces notices that share the Diff bucket id into one updating toast', () => {
    expect(DIFF_BUCKET_NOTICE_ID).toBe('diff-bucket');
    const pushNotice = useExplorerStore.getState().pushNotice;

    pushNotice({
      id: DIFF_BUCKET_NOTICE_ID,
      tone: 'info',
      message: 'Added Dreambane Helm to Diff bucket',
    });
    pushNotice({
      id: DIFF_BUCKET_NOTICE_ID,
      tone: 'info',
      message: 'Added Dreambane Gauntlets to Diff bucket',
    });
    pushNotice({
      id: DIFF_BUCKET_NOTICE_ID,
      tone: 'info',
      message: 'Added Dreambane Plate to Diff bucket',
    });

    const notices = useExplorerStore.getState().notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      id: 'diff-bucket',
      message: 'Added Dreambane Plate to Diff bucket',
    });
  });

  it('keeps coalesced notices inside the cap without evicting unrelated toasts', () => {
    const pushNotice = useExplorerStore.getState().pushNotice;

    pushNotice({ tone: 'warn', message: 'Clipboard unavailable' });
    pushNotice({ id: DIFF_BUCKET_NOTICE_ID, tone: 'info', message: 'Added one' });
    pushNotice({ id: DIFF_BUCKET_NOTICE_ID, tone: 'info', message: 'Added two' });

    const notices = useExplorerStore.getState().notices;
    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.message)).toEqual([
      'Clipboard unavailable',
      'Added two',
    ]);
  });
});
