import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  mergePersistedSettings,
  useSettingsStore,
} from '../../stores/settings';

describe('persisted sorting and grouping settings', () => {
  it('accepts directional sort modes and groupBy when merging persisted settings', () => {
    expect(DEFAULT_SETTINGS.groupBy).toBe('none');
    const current = useSettingsStore.getState();
    const partialize = useSettingsStore.persist.getOptions().partialize;
    const persisted = partialize?.({
      ...current,
      sortMode: 'release-desc',
      groupBy: 'table',
    });
    expect(persisted).toMatchObject({
      sortMode: 'release-desc',
      groupBy: 'table',
    });

    const sortModes = [
      'index-asc',
      'release-desc',
      'release-asc',
      'update-desc',
      'update-asc',
    ] as const;
    for (const sortMode of sortModes) {
      const merged = mergePersistedSettings({ sortMode, groupBy: 'table' }, current);
      expect(merged.sortMode).toBe(sortMode);
      expect(merged.groupBy).toBe('table');
    }
  });

  it('falls back cleanly for invalid persisted values', () => {
    const current = useSettingsStore.getState();
    const merged = mergePersistedSettings(
      { sortMode: 'not-a-sort-mode', groupBy: 'not-a-group' },
      current,
    );
    expect(merged.sortMode).toBe(current.sortMode);
    expect(merged.groupBy).toBe(DEFAULT_SETTINGS.groupBy);
  });
});
