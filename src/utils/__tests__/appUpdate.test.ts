import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForAppUpdate,
  startAppUpdateWatcher,
} from '../appUpdate';

function mockFetch(payload: string, status = 200): typeof fetch {
  return async () =>
    new Response(payload, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('checkForAppUpdate', () => {
  it('does not report an update when the build IDs match', async () => {
    const fetchImpl = vi.fn(mockFetch('{"buildId":"build-1"}'));

    await expect(
      checkForAppUpdate({
        currentBuildId: 'build-1',
        baseUrl: '/',
        fetchImpl,
      }),
    ).resolves.toEqual({ updateAvailable: false });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/^\/version\.json\?t=\d+$/),
      { cache: 'no-store' },
    );
  });

  it('reports a different build ID', async () => {
    await expect(
      checkForAppUpdate({
        currentBuildId: 'build-1',
        baseUrl: '/',
        fetchImpl: mockFetch('{"buildId":"build-2"}'),
      }),
    ).resolves.toEqual({
      updateAvailable: true,
      latestBuildId: 'build-2',
    });
  });

  it.each([
    ['404', mockFetch('', 404)],
    [
      'network failure',
      vi.fn(async () => {
        throw new Error('offline');
      }) as typeof fetch,
    ],
    ['malformed JSON', mockFetch('{broken')],
  ])('silently ignores %s', async (_label, fetchImpl) => {
    await expect(
      checkForAppUpdate({
        currentBuildId: 'build-1',
        baseUrl: '/',
        fetchImpl,
      }),
    ).resolves.toEqual({ updateAvailable: false });
  });
});

describe('startAppUpdateWatcher', () => {
  it('throttles rapid focus and visibility triggers', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(mockFetch('{"buildId":"build-1"}'));
    const cleanup = startAppUpdateWatcher(vi.fn(), {
      currentBuildId: 'build-1',
      baseUrl: '/',
      fetchImpl,
      intervalMs: 120_000,
      minCheckGapMs: 60_000,
      initialDelayMs: 15_000,
    });

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('stops checking after an update is detected', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(mockFetch('{"buildId":"build-2"}'));
    const onUpdateAvailable = vi.fn();
    const cleanup = startAppUpdateWatcher(onUpdateAvailable, {
      currentBuildId: 'build-1',
      baseUrl: '/',
      fetchImpl,
      intervalMs: 1_000,
      minCheckGapMs: 0,
      initialDelayMs: 15_000,
    });

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledWith('build-2');

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
