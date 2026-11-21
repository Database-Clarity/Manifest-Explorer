import { describe, expect, it } from 'vitest';
import { CHANGELOG, computeChangelogOpenState } from '../changelog';

describe('computeChangelogOpenState', () => {
  const latest = CHANGELOG[0]!.version;

  it('opens the latest release only on the first visit', () => {
    expect(computeChangelogOpenState(null)).toEqual({
      shouldAutoOpen: true,
      expandedVersions: [latest],
      unseenVersions: [latest],
    });
    expect(computeChangelogOpenState('')).toEqual({
      shouldAutoOpen: true,
      expandedVersions: [latest],
      unseenVersions: [latest],
    });
  });

  it('does not auto-open for an up-to-date returning visitor', () => {
    expect(computeChangelogOpenState(latest)).toEqual({
      shouldAutoOpen: false,
      expandedVersions: [latest],
      unseenVersions: [],
    });
  });

  it('opens and expands one unseen release when one version behind', () => {
    const lastSeen = CHANGELOG[1]!.version;
    expect(computeChangelogOpenState(lastSeen)).toEqual({
      shouldAutoOpen: true,
      expandedVersions: [latest],
      unseenVersions: [latest],
    });
  });

  it('expands every unseen release and keeps older releases collapsed', () => {
    const lastSeen = CHANGELOG[3]!.version;
    expect(computeChangelogOpenState(lastSeen)).toEqual({
      shouldAutoOpen: true,
      expandedVersions: CHANGELOG.slice(0, 3).map((entry) => entry.version),
      unseenVersions: CHANGELOG.slice(0, 3).map((entry) => entry.version),
    });
  });

  it('safely expands the latest release for an unknown stored version', () => {
    expect(computeChangelogOpenState('unknown-version')).toEqual({
      shouldAutoOpen: true,
      expandedVersions: [latest],
      unseenVersions: [latest],
    });
  });
});
