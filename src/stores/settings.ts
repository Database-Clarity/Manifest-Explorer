import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  BUNGIE_LOCALES,
  type BungieLocale,
  type GroupBy,
  type ImageScalingMode,
  type QueryPrecedence,
  type SortMode,
  type ViewMode,
} from '../types/manifest';

export const SETTINGS_STORAGE_KEY = 'clarity-manifest-settings';

export type ThemeMode = 'system' | 'dark' | 'light';
export type TouchSize = 'compact' | 'large';
export type CodeFontFamily = 'system' | 'fira' | 'cascadia' | 'consolas';
export type HistoryEntryViewMode = 'diff' | 'formatted';
export type HistoryDiffLayout = 'inline' | 'split';
export type ExplorerDiffViewMode = 'diff' | 'formatted';
export type ExplorerDiffLayout = 'split' | 'inline';

export interface SettingsValues {
  theme: ThemeMode;
  uiScale: number;
  touchSize: TouchSize;
  codeFontSize: number;
  codeFontFamily: CodeFontFamily;
  locale: BungieLocale;
  bungieApiKey: string;
  showClarityDescriptions: boolean;
  viewMode: ViewMode;
  sortMode: SortMode;
  imageScaling: ImageScalingMode;
  railCollapsed: boolean;
  railWidth: number;
  inspectorWidth: number;
  /**
   * Persisted width of the results list while the inspector is open. The
   * inspector now claims the remaining space, so the tables rail and the
   * results list never steal width from each other.
   */
  resultsWidth: number;
  fuzzySearch: boolean;
  fuzziness: number;
  queryPrecedence: QueryPrecedence;
  groupBy: GroupBy;
  historyEntryViewMode: HistoryEntryViewMode;
  historyDiffLayout: HistoryDiffLayout;
  explorerDiffViewMode: ExplorerDiffViewMode;
  explorerDiffLayout: ExplorerDiffLayout;
}

export interface SettingsActions {
  setTheme: (theme: ThemeMode) => void;
  setUiScale: (scale: number) => void;
  setTouchSize: (size: TouchSize) => void;
  setCodeFontSize: (size: number) => void;
  setCodeFontFamily: (family: CodeFontFamily) => void;
  setLocale: (locale: BungieLocale) => void;
  setBungieApiKey: (key: string) => void;
  setShowClarityDescriptions: (show: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setSortMode: (mode: SortMode) => void;
  setImageScaling: (mode: ImageScalingMode) => void;
  toggleRail: () => void;
  setRailWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  setResultsWidth: (width: number) => void;
  setFuzzySearch: (enabled: boolean) => void;
  setFuzziness: (value: number) => void;
  setQueryPrecedence: (mode: QueryPrecedence) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setHistoryEntryViewMode: (mode: HistoryEntryViewMode) => void;
  setHistoryDiffLayout: (layout: HistoryDiffLayout) => void;
  setExplorerDiffViewMode: (mode: ExplorerDiffViewMode) => void;
  setExplorerDiffLayout: (layout: ExplorerDiffLayout) => void;
  resetSettings: () => void;
}

export type SettingsState = SettingsValues & SettingsActions;

/**
 * Normalized edit tolerance for sitewide fuzzy search: `0.15` is strict
 * (roughly one small typo), `0.35` is balanced, `0.6` is loose.
 */
export const FUZZINESS_MIN = 0.15;
export const FUZZINESS_MAX = 0.6;
export const FUZZINESS_STEP = 0.05;
export const FUZZINESS_DEFAULT = 0.35;

/**
 * The results list must stay usable in a single column: its header (count,
 * Diff shortcut, sort, list/grid toggle) fits inside 280px with room to spare.
 */
export const RESULTS_WIDTH_MIN = 280;
export const RESULTS_WIDTH_MAX = 4000;
export const RESULTS_WIDTH_DEFAULT = 440;
/**
 * Rendered floor for the inspector (24rem at the default 16px root size). The
 * results pane max width always leaves at least this much room on the right.
 */
export const INSPECTOR_MIN_WIDTH = 384;

export type FuzzinessLevel = 'Strict' | 'Balanced' | 'Loose';

/** Human-readable tier for a normalized fuzziness value, shared by settings UIs. */
export function fuzzinessLevel(value: number): FuzzinessLevel {
  const normalized = normalizeFuzziness(value);
  if (normalized <= 0.25) {
    return 'Strict';
  }
  if (normalized <= 0.45) {
    return 'Balanced';
  }
  return 'Loose';
}

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'system',
  uiScale: 100,
  touchSize: 'compact',
  codeFontSize: 13,
  codeFontFamily: 'system',
  locale: 'en',
  bungieApiKey: '',
  showClarityDescriptions: true,
  viewMode: 'grid',
  sortMode: 'relevance',
  imageScaling: 'sharp',
  railCollapsed: true,
  railWidth: 224,
  inspectorWidth: 1280,
  resultsWidth: RESULTS_WIDTH_DEFAULT,
  fuzzySearch: false,
  fuzziness: FUZZINESS_DEFAULT,
  queryPrecedence: 'dim',
  groupBy: 'none',
  historyEntryViewMode: 'diff',
  historyDiffLayout: 'split',
  explorerDiffViewMode: 'diff',
  explorerDiffLayout: 'split',
};

export const UI_SCALE_MIN = 85;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_STEP = 5;
export const CODE_FONT_SIZE_MIN = 11;
export const CODE_FONT_SIZE_MAX = 18;
export const RAIL_WIDTH_MIN = 168;
export const RAIL_WIDTH_MAX = 340;
export const INSPECTOR_WIDTH_MIN = 380;
export const INSPECTOR_WIDTH_MAX = 1600;

const THEME_MODES: readonly ThemeMode[] = ['system', 'dark', 'light'];
const TOUCH_SIZES: readonly TouchSize[] = ['compact', 'large'];
const CODE_FONT_FAMILIES: readonly CodeFontFamily[] = ['system', 'fira', 'cascadia', 'consolas'];
const IMAGE_SCALING_MODES: readonly ImageScalingMode[] = ['sharp', 'integer', 'smooth'];
const QUERY_PRECEDENCE_MODES: readonly QueryPrecedence[] = ['dim', 'standard'];
const BUNGIE_LOCALE_CODES: readonly BungieLocale[] = BUNGIE_LOCALES.map((locale) => locale.code);

/**
 * Fira Code is listed first in the default stack so installs that already have
 * it get its shapes automatically; the explicit `fira` option is for users who
 * want it pinned ahead of every other installed monospace face.
 */
const CODE_FONT_STACKS: Record<CodeFontFamily, string> = {
  system: "'Fira Code', ui-monospace, 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
  fira: "'Fira Code', 'FiraCode Nerd Font', 'Cascadia Code', ui-monospace, Consolas, 'Liberation Mono', monospace",
  cascadia: "'Cascadia Code', 'Cascadia Mono', Consolas, 'Liberation Mono', monospace",
  consolas: "Consolas, 'Cascadia Code', ui-monospace, 'Liberation Mono', monospace",
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function snap(value: number, min: number, max: number, step: number): number {
  const clamped = clamp(value, min, max);
  return clamp(Math.round((clamped - min) / step) * step + min, min, max);
}

function normalizeUiScale(value: number): number {
  return snap(value, UI_SCALE_MIN, UI_SCALE_MAX, UI_SCALE_STEP);
}

function normalizeCodeFontSize(value: number): number {
  return Math.round(clamp(value, CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX));
}

function normalizeRailWidth(value: number): number {
  return Math.round(clamp(value, RAIL_WIDTH_MIN, RAIL_WIDTH_MAX));
}

function normalizeInspectorWidth(value: number): number {
  return Math.round(clamp(value, INSPECTOR_WIDTH_MIN, INSPECTOR_WIDTH_MAX));
}

function normalizeResultsWidth(value: number): number {
  return Math.round(clamp(value, RESULTS_WIDTH_MIN, RESULTS_WIDTH_MAX));
}

/**
 * Upper bound for the results pane while the inspector is open. The inspector
 * keeps at least {@link INSPECTOR_MIN_WIDTH}px of the workspace after the
 * tables rail and results list have taken their independent widths.
 */
export function maxResultsWidth(workspaceWidth: number, railWidth: number): number {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return RESULTS_WIDTH_MAX;
  }
  const rail = Number.isFinite(railWidth) && railWidth > 0 ? railWidth : 0;
  return Math.max(
    RESULTS_WIDTH_MIN,
    Math.floor(workspaceWidth - rail - INSPECTOR_MIN_WIDTH),
  );
}

/** Clamp a results width to the usable `[280, max]` window. */
export function clampResultsWidth(width: number, maxWidth: number): number {
  const upper = Math.max(RESULTS_WIDTH_MIN, Math.round(maxWidth));
  const value = Number.isFinite(width) ? width : RESULTS_WIDTH_DEFAULT;
  return Math.round(clamp(value, RESULTS_WIDTH_MIN, upper));
}

function normalizeFuzziness(value: number): number {
  return Number(snap(value, FUZZINESS_MIN, FUZZINESS_MAX, FUZZINESS_STEP).toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export type SettingsDomInput = Pick<
  SettingsValues,
  'theme' | 'uiScale' | 'touchSize' | 'codeFontSize' | 'codeFontFamily'
>;

/**
 * Applies the settings that map to CSS/DOM state. Safe to call repeatedly and
 * safe in environments without a document (SSR, unit tests before jsdom boot).
 */
export function applySettingsToDom(state: SettingsDomInput): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  if (state.theme === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', state.theme);
  }

  const scale = normalizeUiScale(state.uiScale);
  root.style.fontSize = `${(scale / 100) * 16}px`;

  if (state.touchSize === 'large') {
    root.setAttribute('data-touch', 'large');
  } else {
    root.removeAttribute('data-touch');
  }

  root.style.setProperty('--code-font-size', `${normalizeCodeFontSize(state.codeFontSize)}px`);
  root.style.setProperty('--code-font-family', CODE_FONT_STACKS[state.codeFontFamily]);
}

export function mergePersistedSettings(
  persistedState: unknown,
  currentState: SettingsState,
): SettingsState {
  if (!isRecord(persistedState)) {
    return currentState;
  }

  return {
    ...currentState,
    theme: readEnum(persistedState.theme, THEME_MODES, currentState.theme),
    uiScale: normalizeUiScale(readNumber(persistedState.uiScale, currentState.uiScale)),
    touchSize: readEnum(persistedState.touchSize, TOUCH_SIZES, currentState.touchSize),
    codeFontSize: normalizeCodeFontSize(readNumber(persistedState.codeFontSize, currentState.codeFontSize)),
    codeFontFamily: readEnum(persistedState.codeFontFamily, CODE_FONT_FAMILIES, currentState.codeFontFamily),
    locale: readEnum(persistedState.locale, BUNGIE_LOCALE_CODES, currentState.locale),
    bungieApiKey: readString(persistedState.bungieApiKey, currentState.bungieApiKey),
    showClarityDescriptions: readBoolean(
      persistedState.showClarityDescriptions,
      currentState.showClarityDescriptions,
    ),
    viewMode: readEnum(persistedState.viewMode, ['list', 'grid'] as const, currentState.viewMode),
    sortMode: readEnum(
      persistedState.sortMode,
      [
        'relevance',
        'name-asc',
        'name-desc',
        'hash-asc',
        'hash-desc',
        'index-asc',
        'index-desc',
        'release-desc',
        'release-asc',
        'update-desc',
        'update-asc',
      ] as const,
      currentState.sortMode,
    ),
    groupBy: readEnum(persistedState.groupBy, ['none', 'table'] as const, currentState.groupBy),
    imageScaling: readEnum(
      persistedState.imageScaling,
      IMAGE_SCALING_MODES,
      currentState.imageScaling,
    ),
    railCollapsed: readBoolean(persistedState.railCollapsed, currentState.railCollapsed),
    railWidth: normalizeRailWidth(readNumber(persistedState.railWidth, currentState.railWidth)),
    inspectorWidth: normalizeInspectorWidth(
      readNumber(persistedState.inspectorWidth, currentState.inspectorWidth),
    ),
    resultsWidth: normalizeResultsWidth(
      readNumber(persistedState.resultsWidth, currentState.resultsWidth),
    ),
    fuzzySearch: readBoolean(persistedState.fuzzySearch, currentState.fuzzySearch),
    fuzziness: normalizeFuzziness(readNumber(persistedState.fuzziness, currentState.fuzziness)),
    queryPrecedence: readEnum(
      persistedState.queryPrecedence,
      QUERY_PRECEDENCE_MODES,
      currentState.queryPrecedence,
    ),
    historyEntryViewMode: readEnum(
      persistedState.historyEntryViewMode,
      ['diff', 'formatted'] as const,
      currentState.historyEntryViewMode,
    ),
    historyDiffLayout: readEnum(
      persistedState.historyDiffLayout,
      ['inline', 'split'] as const,
      currentState.historyDiffLayout,
    ),
    explorerDiffViewMode: readEnum(
      persistedState.explorerDiffViewMode,
      ['diff', 'formatted'] as const,
      currentState.explorerDiffViewMode,
    ),
    explorerDiffLayout: readEnum(
      persistedState.explorerDiffLayout,
      ['inline', 'split'] as const,
      currentState.explorerDiffLayout,
    ),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => {
      const commit = (partial: Partial<SettingsValues>): void => {
        set(partial);
        applySettingsToDom(get());
      };

      return {
        ...DEFAULT_SETTINGS,
        setTheme: (theme) => commit({ theme }),
        setUiScale: (uiScale) => commit({ uiScale: normalizeUiScale(uiScale) }),
        setTouchSize: (touchSize) => commit({ touchSize }),
        setCodeFontSize: (codeFontSize) => commit({ codeFontSize: normalizeCodeFontSize(codeFontSize) }),
        setCodeFontFamily: (codeFontFamily) => commit({ codeFontFamily }),
        setLocale: (locale) => commit({ locale }),
        setBungieApiKey: (bungieApiKey) => commit({ bungieApiKey }),
        setShowClarityDescriptions: (showClarityDescriptions) => commit({ showClarityDescriptions }),
        setViewMode: (viewMode) => commit({ viewMode }),
        setSortMode: (sortMode) => commit({ sortMode }),
        setImageScaling: (imageScaling) => commit({ imageScaling }),
        toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
        setRailWidth: (railWidth) => commit({ railWidth: normalizeRailWidth(railWidth) }),
        setInspectorWidth: (inspectorWidth) =>
          commit({ inspectorWidth: normalizeInspectorWidth(inspectorWidth) }),
        setResultsWidth: (resultsWidth) =>
          commit({ resultsWidth: normalizeResultsWidth(resultsWidth) }),
        setFuzzySearch: (fuzzySearch) => commit({ fuzzySearch }),
        setFuzziness: (fuzziness) => commit({ fuzziness: normalizeFuzziness(fuzziness) }),
        setQueryPrecedence: (queryPrecedence) => commit({ queryPrecedence }),
        setGroupBy: (groupBy) => commit({ groupBy }),
        setHistoryEntryViewMode: (historyEntryViewMode) =>
          commit({ historyEntryViewMode }),
        setHistoryDiffLayout: (historyDiffLayout) => commit({ historyDiffLayout }),
        setExplorerDiffViewMode: (explorerDiffViewMode) => commit({ explorerDiffViewMode }),
        setExplorerDiffLayout: (explorerDiffLayout) => commit({ explorerDiffLayout }),
        resetSettings: () => {
          set(DEFAULT_SETTINGS);
          applySettingsToDom(get());
        },
      };
    },
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): SettingsValues => ({
        theme: state.theme,
        uiScale: state.uiScale,
        touchSize: state.touchSize,
        codeFontSize: state.codeFontSize,
        codeFontFamily: state.codeFontFamily,
        locale: state.locale,
        bungieApiKey: state.bungieApiKey,
        showClarityDescriptions: state.showClarityDescriptions,
        viewMode: state.viewMode,
        sortMode: state.sortMode,
        imageScaling: state.imageScaling,
        railCollapsed: state.railCollapsed,
        railWidth: state.railWidth,
        inspectorWidth: state.inspectorWidth,
        resultsWidth: state.resultsWidth,
        fuzzySearch: state.fuzzySearch,
        fuzziness: state.fuzziness,
        queryPrecedence: state.queryPrecedence,
        groupBy: state.groupBy,
        historyEntryViewMode: state.historyEntryViewMode,
        historyDiffLayout: state.historyDiffLayout,
        explorerDiffViewMode: state.explorerDiffViewMode,
        explorerDiffLayout: state.explorerDiffLayout,
      }),
      merge: mergePersistedSettings,
      onRehydrateStorage: () => (state) => {
        applySettingsToDom(state ?? DEFAULT_SETTINGS);
      },
    },
  ),
);

// Keep the document in sync even when there was nothing persisted to rehydrate.
applySettingsToDom(useSettingsStore.getState());
