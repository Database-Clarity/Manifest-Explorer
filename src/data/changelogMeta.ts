export const CHANGELOG_STORAGE_KEY = 'clarity-manifest-explorer:last-seen-changelog';

/** Keep in sync with CHANGELOG[0].version in changelog.ts. */
export const LATEST_CHANGELOG_VERSION = '2026.11.24-2';

export const CHANGELOG_SEEN_EVENT = 'manifest-explorer:changelog-seen';

export function readLastSeenChangelogVersion(): string | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    const version = window.localStorage.getItem(CHANGELOG_STORAGE_KEY);
    return version?.trim() || null;
  } catch {
    return null;
  }
}

export function writeLastSeenChangelogVersion(version: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(CHANGELOG_STORAGE_KEY, version);
  } catch {
    // Storage can be unavailable in private browsing or under restrictive policies.
  } finally {
    window.dispatchEvent(new Event(CHANGELOG_SEEN_EVENT));
  }
}

export function hasUnseenChangelogMeta(
  lastSeenVersion = readLastSeenChangelogVersion(),
): boolean {
  return lastSeenVersion !== LATEST_CHANGELOG_VERSION;
}

export function shouldAutoOpenChangelog(
  lastSeenVersion = readLastSeenChangelogVersion(),
): boolean {
  return hasUnseenChangelogMeta(lastSeenVersion);
}
