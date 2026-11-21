/// <reference types="vite/client" />
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { BungieLocale } from '../types/manifest';
import { BUNGIE_LOCALES } from '../types/manifest';
import type { CodeFontFamily, ThemeMode, TouchSize } from '../stores/settings';
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  useSettingsStore,
} from '../stores/settings';
import { useExplorerStore } from '../stores/explorer';
import { ChevronDownIcon, ChevronRightIcon } from '../ui/Icons';
import { Popover } from '../ui/Popover';
import styles from './SettingsPopover.module.scss';

export interface SettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  onCheckUpdates: () => void;
  onClearCache: () => void;
  onLoadAllTables: () => void;
  onLocaleChange: (locale: BungieLocale) => void;
}

const THEME_OPTIONS: ReadonlyArray<readonly [ThemeMode, string]> = [
  ['system', 'System'],
  ['dark', 'Dark'],
  ['light', 'Light'],
];

const TOUCH_OPTIONS: ReadonlyArray<readonly [TouchSize, string]> = [
  ['compact', 'Compact'],
  ['large', 'Large (44px)'],
];

const CODE_FONT_OPTIONS: ReadonlyArray<readonly [CodeFontFamily, string]> = [
  ['system', 'System'],
  ['cascadia', 'Cascadia'],
  ['consolas', 'Consolas'],
];

interface StepperProps {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function Stepper({ label, value, display, min, max, step, onChange }: StepperProps): ReactNode {
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => onChange(value - step)}
        disabled={value <= min}
        aria-label={`${label}: decrease`}
      >
        −
      </button>
      <span className={styles.stepValue} aria-live="polite">
        {display}
      </span>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => onChange(value + step)}
        disabled={value >= max}
        aria-label={`${label}: increase`}
      >
        +
      </button>
    </div>
  );
}

export function SettingsPopover({
  open,
  onClose,
  anchorRef,
  onCheckUpdates,
  onClearCache,
  onLoadAllTables,
  onLocaleChange,
}: SettingsPopoverProps): ReactNode {
  const [confirmClear, setConfirmClear] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);

  const theme = useSettingsStore((state) => state.theme);
  const uiScale = useSettingsStore((state) => state.uiScale);
  const touchSize = useSettingsStore((state) => state.touchSize);
  const codeFontSize = useSettingsStore((state) => state.codeFontSize);
  const codeFontFamily = useSettingsStore((state) => state.codeFontFamily);
  const locale = useSettingsStore((state) => state.locale);
  const bungieApiKey = useSettingsStore((state) => state.bungieApiKey);
  const showClarityDescriptions = useSettingsStore((state) => state.showClarityDescriptions);

  const setTheme = useSettingsStore((state) => state.setTheme);
  const setUiScale = useSettingsStore((state) => state.setUiScale);
  const setTouchSize = useSettingsStore((state) => state.setTouchSize);
  const setCodeFontSize = useSettingsStore((state) => state.setCodeFontSize);
  const setCodeFontFamily = useSettingsStore((state) => state.setCodeFontFamily);
  const setBungieApiKey = useSettingsStore((state) => state.setBungieApiKey);
  const setShowClarityDescriptions = useSettingsStore((state) => state.setShowClarityDescriptions);
  const resetSettings = useSettingsStore((state) => state.resetSettings);

  const manifestStatus = useExplorerStore((state) => state.manifestStatus);

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
    }
  }, [open]);

  const tableTotal = manifestStatus.totalTableCount > 0 ? manifestStatus.totalTableCount : 98;

  function handleClearCache(): void {
    onClearCache();
    setConfirmClear(false);
  }

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="end"
      label="Settings"
      width="20rem"
    >
      <div className={styles.body}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Theme</span>
            <div className={styles.segmented} role="group" aria-label="Theme">
              {THEME_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    value === theme ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn
                  }
                  aria-pressed={value === theme}
                  onClick={() => setTheme(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Interface scale</span>
            <Stepper
              label="Interface scale"
              value={uiScale}
              display={`${uiScale}%`}
              min={UI_SCALE_MIN}
              max={UI_SCALE_MAX}
              step={UI_SCALE_STEP}
              onChange={setUiScale}
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Interaction</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Touch target size</span>
            <div className={styles.segmented} role="group" aria-label="Touch target size">
              {TOUCH_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    value === touchSize ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn
                  }
                  aria-pressed={value === touchSize}
                  onClick={() => setTouchSize(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Code</h2>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Font size</span>
            <Stepper
              label="Code font size"
              value={codeFontSize}
              display={`${codeFontSize}px`}
              min={CODE_FONT_SIZE_MIN}
              max={CODE_FONT_SIZE_MAX}
              step={1}
              onChange={setCodeFontSize}
            />
          </div>
          <div className={styles.row}>
            <label className={styles.rowLabel} htmlFor="settings-code-font">
              Font family
            </label>
            <select
              id="settings-code-font"
              className={styles.select}
              value={codeFontFamily}
              onChange={(event) => setCodeFontFamily(event.target.value as CodeFontFamily)}
            >
              {CODE_FONT_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Language</h2>
          <select
            className={styles.selectWide}
            value={locale}
            onChange={(event) => onLocaleChange(event.target.value as BungieLocale)}
            aria-label="Manifest language"
          >
            {BUNGIE_LOCALES.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </section>

        <section className={styles.section}>
          <button
            type="button"
            role="switch"
            aria-checked={showClarityDescriptions}
            className={styles.switchRow}
            onClick={() => setShowClarityDescriptions(!showClarityDescriptions)}
          >
            <span className={styles.rowLabel}>Show Clarity community descriptions</span>
            <span
              className={`${styles.switch} ${showClarityDescriptions ? styles.switchOn : ''}`}
              aria-hidden="true"
            >
              <span className={styles.knob} />
            </span>
          </button>
        </section>

        <section className={styles.section}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={keyOpen}
            onClick={() => setKeyOpen((current) => !current)}
          >
            {keyOpen ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
            <span>Bungie API key (optional fallback)</span>
          </button>
          {keyOpen && (
            <div className={styles.keyBlock}>
              <input
                type={keyVisible ? 'text' : 'password'}
                className={styles.keyInput}
                value={bungieApiKey}
                onChange={(event) => setBungieApiKey(event.target.value)}
                placeholder="Paste an API key"
                aria-label="Bungie API key"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className={styles.quietBtn}
                onClick={() => setKeyVisible((current) => !current)}
                aria-pressed={keyVisible}
              >
                {keyVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Cache</h2>
          <div className={styles.cacheMeta}>
            <span className={styles.cacheVersion}>
              {manifestStatus.version.length > 0 ? manifestStatus.version : 'Not loaded'}
            </span>
            <span className={styles.cacheLocale}>{manifestStatus.locale}</span>
            {manifestStatus.fromCache && <span className={styles.cacheBadge}>cached</span>}
          </div>
          <div className={styles.cacheActions}>
            <button type="button" className={styles.actionBtn} onClick={onCheckUpdates}>
              Check updates
            </button>
            <button type="button" className={styles.actionBtn} onClick={onLoadAllTables}>
              Load all {tableTotal} tables
            </button>
            {confirmClear ? (
              <div className={styles.confirm}>
                <span className={styles.confirmText}>Clear the offline manifest cache?</span>
                <div className={styles.confirmActions}>
                  <button
                    type="button"
                    className={`${styles.actionBtn} ${styles.dangerBtn}`}
                    onClick={handleClearCache}
                  >
                    Clear cache
                  </button>
                  <button
                    type="button"
                    className={styles.quietBtn}
                    onClick={() => setConfirmClear(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.dangerBtn}`}
                onClick={() => setConfirmClear(true)}
              >
                Clear cache
              </button>
            )}
            <button type="button" className={styles.quietBtn} onClick={resetSettings}>
              Reset settings
            </button>
          </div>
        </section>
      </div>
    </Popover>
  );
}
