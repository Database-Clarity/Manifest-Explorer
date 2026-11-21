export const CURRENT_APP_BUILD_ID =
  typeof __APP_BUILD_ID__ === 'string' ? __APP_BUILD_ID__ : 'dev';

export interface AppUpdateCheckOptions {
  currentBuildId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface AppUpdateCheckResult {
  updateAvailable: boolean;
  latestBuildId?: string;
}

export async function checkForAppUpdate(
  options: AppUpdateCheckOptions = {},
): Promise<AppUpdateCheckResult> {
  const currentBuildId = options.currentBuildId ?? CURRENT_APP_BUILD_ID;
  if (
    currentBuildId === 'dev' ||
    (import.meta.env.DEV && options.currentBuildId === undefined)
  ) {
    return { updateAvailable: false };
  }

  const baseUrl = options.baseUrl ?? import.meta.env.BASE_URL;
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = `${normalizedBaseUrl}version.json?t=${Date.now()}`;

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) {
      return { updateAvailable: false };
    }

    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null) {
      return { updateAvailable: false };
    }

    const latestBuildId = (payload as Record<string, unknown>).buildId;
    if (
      typeof latestBuildId === 'string' &&
      latestBuildId.length > 0 &&
      latestBuildId !== currentBuildId
    ) {
      return { updateAvailable: true, latestBuildId };
    }
  } catch {
    // Keep cached/offline use quiet and uninterrupted.
  }

  return { updateAvailable: false };
}

export interface AppUpdateWatcherOptions extends AppUpdateCheckOptions {
  intervalMs?: number;
  minCheckGapMs?: number;
  initialDelayMs?: number;
}

export function startAppUpdateWatcher(
  onUpdateAvailable: (latestBuildId: string) => void,
  options: AppUpdateWatcherOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  const minCheckGapMs = options.minCheckGapMs ?? 60 * 1000;
  const initialDelayMs = options.initialDelayMs ?? 15 * 1000;

  let active = true;
  let lastCheckAt: number | null = null;
  let initialTimer: number | undefined;
  let intervalTimer: number | undefined;

  const cleanup = (): void => {
    if (!active) {
      return;
    }
    active = false;
    if (initialTimer !== undefined) {
      window.clearTimeout(initialTimer);
    }
    if (intervalTimer !== undefined) {
      window.clearInterval(intervalTimer);
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onWindowEvent);
    window.removeEventListener('online', onWindowEvent);
  };

  const check = (respectGap: boolean, requireVisible: boolean): void => {
    if (!active || (requireVisible && document.visibilityState !== 'visible')) {
      return;
    }
    const now = Date.now();
    if (
      respectGap &&
      lastCheckAt !== null &&
      now - lastCheckAt < minCheckGapMs
    ) {
      return;
    }
    lastCheckAt = now;

    void checkForAppUpdate(options).then((result) => {
      if (!active || !result.updateAvailable || !result.latestBuildId) {
        return;
      }
      cleanup();
      onUpdateAvailable(result.latestBuildId);
    });
  };

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      check(true, true);
    }
  }

  function onWindowEvent(): void {
    check(true, false);
  }

  initialTimer = window.setTimeout(() => {
    check(true, true);
  }, initialDelayMs);
  intervalTimer = window.setInterval(() => {
    check(true, true);
  }, intervalMs);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('focus', onWindowEvent);
  window.addEventListener('online', onWindowEvent);

  return cleanup;
}
