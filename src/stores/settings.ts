import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { BUNGIE_LOCALES, type BungieLocale, type SortMode, type ViewMode } from '../types/manifest';

export const SETTINGS_STORAGE_KEY = 'clarity-manifest-settings';

export type ThemeMode = 'system' | 'dark' | 'light';
export type TouchSize = 'compact' | 'large';
export type CodeFontFamily = 'system' | 'cascadia' | 'consolas';

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
  railCollapsed: boolean;
  railWidth: number;
  inspectorWidth: number;
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
  toggleRail: () => void;
  setRailWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
  resetSettings: () => void;
}

export type SettingsState = SettingsValues & SettingsActions;

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'system',
  uiScale: 100,
  touchSize: 'compact',
  codeFontSize: 13,
  codeFontFamily: 'system',
  locale: 'en',
  bungieApiKey: '',
  showClarityDescriptions: true,
  viewMode: 'list',
  sortMode: 'relevance',
  railCollapsed: false,
  railWidth: 224,
  inspectorWidth: 620,
};

export const UI_SCALE_MIN = 85;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_STEP = 5;
export const CODE_FONT_SIZE_MIN = 11;
export const CODE_FONT_SIZE_MAX = 18;
export const RAIL_WIDTH_MIN = 168;
export const RAIL_WIDTH_MAX = 340;
export const INSPECTOR_WIDTH_MIN = 380;
export const INSPECTOR_WIDTH_MAX = 1280;

const THEME_MODES: readonly ThemeMode[] = ['system', 'dark', 'light'];
const TOUCH_SIZES: readonly TouchSize[] = ['compact', 'large'];
const CODE_FONT_FAMILIES: readonly CodeFontFamily[] = ['system', 'cascadia', 'consolas'];
const BUNGIE_LOCALE_CODES: readonly BungieLocale[] = BUNGIE_LOCALES.map((locale) => locale.code);

const CODE_FONT_STACKS: Record<CodeFontFamily, string> = {
  system: "ui-monospace, 'Cascadia Code', Consolas, 'Liberation Mono', monospace",
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

function mergePersistedSettings(persistedState: unknown, currentState: SettingsState): SettingsState {
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
      ['relevance', 'name-asc', 'name-desc', 'hash-asc', 'hash-desc', 'index-desc'] as const,
      currentState.sortMode,
    ),
    railCollapsed: readBoolean(persistedState.railCollapsed, currentState.railCollapsed),
    railWidth: normalizeRailWidth(readNumber(persistedState.railWidth, currentState.railWidth)),
    inspectorWidth: normalizeInspectorWidth(
      readNumber(persistedState.inspectorWidth, currentState.inspectorWidth),
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
        toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
        setRailWidth: (railWidth) => commit({ railWidth: normalizeRailWidth(railWidth) }),
        setInspectorWidth: (inspectorWidth) =>
          commit({ inspectorWidth: normalizeInspectorWidth(inspectorWidth) }),
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
        railCollapsed: state.railCollapsed,
        railWidth: state.railWidth,
        inspectorWidth: state.inspectorWidth,
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
