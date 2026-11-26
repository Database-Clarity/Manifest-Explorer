import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  RESULTS_WIDTH_MAX,
  RESULTS_WIDTH_MIN,
  clampResultsWidth,
  maxResultsWidth,
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

  it('persists the History viewer mode and diff layout with safe defaults', () => {
    expect(DEFAULT_SETTINGS.historyEntryViewMode).toBe('diff');
    expect(DEFAULT_SETTINGS.historyDiffLayout).toBe('split');

    const current = useSettingsStore.getState();
    const partialize = useSettingsStore.persist.getOptions().partialize;
    const persisted = partialize?.({
      ...current,
      historyEntryViewMode: 'formatted',
      historyDiffLayout: 'inline',
    });
    expect(persisted).toMatchObject({
      historyEntryViewMode: 'formatted',
      historyDiffLayout: 'inline',
    });

    expect(
      mergePersistedSettings(
        { historyEntryViewMode: 'invalid', historyDiffLayout: 'invalid' },
        current,
      ),
    ).toMatchObject({
      historyEntryViewMode: 'diff',
      historyDiffLayout: 'split',
    });
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

  it('persists an independent results width and migrates older payloads', () => {
    expect(DEFAULT_SETTINGS.resultsWidth).toBe(440);
    expect(DEFAULT_SETTINGS.inspectorWidth).toBe(1280);

    const current = useSettingsStore.getState();
    const partialize = useSettingsStore.persist.getOptions().partialize;
    const persisted = partialize?.({
      ...current,
      inspectorWidth: 900,
      resultsWidth: 512,
    });
    expect(persisted).toMatchObject({ inspectorWidth: 900, resultsWidth: 512 });

    // Older localStorage payloads only carried `inspectorWidth`: keep it and
    // hydrate the new results width from its default instead of resetting it.
    const legacy = mergePersistedSettings({ inspectorWidth: 1111 }, current);
    expect(legacy.inspectorWidth).toBe(1111);
    expect(legacy.resultsWidth).toBe(DEFAULT_SETTINGS.resultsWidth);

    expect(mergePersistedSettings({ resultsWidth: 100 }, current).resultsWidth).toBe(
      RESULTS_WIDTH_MIN,
    );
    expect(
      mergePersistedSettings({ resultsWidth: 9000 }, current).resultsWidth,
    ).toBe(RESULTS_WIDTH_MAX);
  });

  it('clamps the results width so the inspector keeps its minimum share', () => {
    expect(maxResultsWidth(1600, 224)).toBe(992);
    expect(maxResultsWidth(600, 224)).toBe(RESULTS_WIDTH_MIN);
    expect(maxResultsWidth(0, 224)).toBe(RESULTS_WIDTH_MAX);

    expect(clampResultsWidth(100, 992)).toBe(RESULTS_WIDTH_MIN);
    expect(clampResultsWidth(512, 992)).toBe(512);
    expect(clampResultsWidth(1200, 992)).toBe(992);
    expect(clampResultsWidth(1200, RESULTS_WIDTH_MIN)).toBe(RESULTS_WIDTH_MIN);
  });
});
