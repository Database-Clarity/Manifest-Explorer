/// <reference types="vite/client" />
import { useState, type ReactNode, type RefObject } from 'react';
import type { BungieLocale, ImageScalingMode, QueryPrecedence } from '../types/manifest';
import { BUNGIE_LOCALES } from '../types/manifest';
import type { CodeFontFamily, ThemeMode, TouchSize } from '../stores/settings';
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  FUZZINESS_MAX,
  FUZZINESS_MIN,
  FUZZINESS_STEP,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  fuzzinessLevel,
  useSettingsStore,
} from '../stores/settings';
import { useExplorerStore } from '../stores/explorer';
import {
  ChevronDownIcon,
  ChevronRightIcon,
} from '../ui/Icons';
import { Popover } from '../ui/Popover';
import { Select } from '../ui/Select';
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
  ['fira', 'Fira Code'],
  ['cascadia', 'Cascadia'],
  ['consolas', 'Consolas'],
];

const IMAGE_SCALING_OPTIONS: ReadonlyArray<readonly [ImageScalingMode, string]> = [
  ['sharp', 'Sharp'],
  ['integer', 'Integer'],
  ['smooth', 'Smooth'],
];

const QUERY_PRECEDENCE_OPTIONS: ReadonlyArray<readonly [QueryPrecedence, string]> = [
  ['dim', 'DIM'],
  ['standard', 'Standard'],
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

/**
 * Zero-cost shell: while the popover is closed nothing below mounts, so no
 * settings subscription or manifest-status read runs on unrelated renders.
 * `Popover` restores focus to the anchor from its effect cleanup on unmount,
 * so Escape and outside-click closing behave exactly as before.
 */
export function SettingsPopover(props: SettingsPopoverProps): ReactNode {
  if (!props.open) {
    return null;
  }
  return <SettingsPopoverBody {...props} />;
}

function SettingsPopoverBody({
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
  const imageScaling = useSettingsStore((state) => state.imageScaling);
  const locale = useSettingsStore((state) => state.locale);
  const bungieApiKey = useSettingsStore((state) => state.bungieApiKey);
  const showClarityDescriptions = useSettingsStore((state) => state.showClarityDescriptions);
  const fuzzySearch = useSettingsStore((state) => state.fuzzySearch);
  const fuzziness = useSettingsStore((state) => state.fuzziness);
  const queryPrecedence = useSettingsStore((state) => state.queryPrecedence);

  const setTheme = useSettingsStore((state) => state.setTheme);
  const setUiScale = useSettingsStore((state) => state.setUiScale);
  const setTouchSize = useSettingsStore((state) => state.setTouchSize);
  const setCodeFontSize = useSettingsStore((state) => state.setCodeFontSize);
  const setCodeFontFamily = useSettingsStore((state) => state.setCodeFontFamily);
  const setImageScaling = useSettingsStore((state) => state.setImageScaling);
  const setBungieApiKey = useSettingsStore((state) => state.setBungieApiKey);
  const setShowClarityDescriptions = useSettingsStore((state) => state.setShowClarityDescriptions);
  const setFuzzySearch = useSettingsStore((state) => state.setFuzzySearch);
  const setFuzziness = useSettingsStore((state) => state.setFuzziness);
  const setQueryPrecedence = useSettingsStore((state) => state.setQueryPrecedence);
  const resetSettings = useSettingsStore((state) => state.resetSettings);

  const manifestStatus = useExplorerStore((state) => state.manifestStatus);
  const tableTotal = manifestStatus.totalTableCount > 0 ? manifestStatus.totalTableCount : 98;
  const fuzzinessPercent = Math.round(fuzziness * 100);
  const fuzzinessTier = fuzzinessLevel(fuzziness);

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
          <div className={styles.row}>
            <span className={styles.rowLabel}>Image scaling</span>
            <div className={styles.segmented} role="group" aria-label="Image scaling">
              {IMAGE_SCALING_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    value === imageScaling ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn
                  }
                  aria-pressed={value === imageScaling}
                  onClick={() => setImageScaling(value)}
                >
                  {label}
                </button>
              ))}
            </div>
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
          <h2 className={styles.sectionTitle}>Search</h2>
          <button
            type="button"
            role="switch"
            aria-checked={fuzzySearch}
            className={styles.switchRow}
            onClick={() => setFuzzySearch(!fuzzySearch)}
          >
            <span className={styles.switchLabel}>
              <span className={styles.rowLabel}>Fuzzy search</span>
              <span className={styles.rowHint}>
                Match results through typos across the manifest
              </span>
            </span>
            <span
              className={`${styles.switch} ${fuzzySearch ? styles.switchOn : ''}`}
              aria-hidden="true"
            >
              <span className={styles.knob} />
            </span>
          </button>
          <div
            className={`${styles.sliderBlock} ${fuzzySearch ? '' : styles.sliderBlockOff}`}
          >
            <div className={styles.sliderHead}>
              <span className={styles.rowLabel}>Fuzziness</span>
              <span className={styles.levelBadge}>
                {fuzzinessTier} ({fuzzinessPercent}%)
              </span>
            </div>
            <input
              type="range"
              className={styles.range}
              min={FUZZINESS_MIN}
              max={FUZZINESS_MAX}
              step={FUZZINESS_STEP}
              value={fuzziness}
              disabled={!fuzzySearch}
              onChange={(event) => setFuzziness(Number(event.target.value))}
              aria-label="Search fuzziness"
              aria-valuetext={`${fuzzinessTier}, ${fuzzinessPercent}%`}
            />
            <div className={styles.sliderScale} aria-hidden="true">
              <span>Strict</span>
              <span>Loose</span>
            </div>
          </div>
          <div className={styles.precedenceBlock}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Query logic</span>
              <div className={styles.segmented} role="group" aria-label="Query logic">
                {QUERY_PRECEDENCE_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      value === queryPrecedence ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn
                    }
                    aria-pressed={value === queryPrecedence}
                    onClick={() => setQueryPrecedence(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.precedenceHint} aria-live="polite">
              {queryPrecedence === 'dim' ? (
                <>
                  <code>a b or c</code> → <code>a AND (b OR c)</code> — matches DIM.
                  Explicit &quot;and&quot; binds tighter than &quot;or&quot;.
                </>
              ) : (
                <>
                  <code>a b or c</code> → <code>(a AND b) OR c</code> — spaces and
                  &quot;and&quot; both bind tighter than &quot;or&quot;.
                </>
              )}
            </p>
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
            <Select<CodeFontFamily>
              id="settings-code-font"
              className={styles.select}
              minPopupWidth="10rem"
              value={codeFontFamily}
              onChange={setCodeFontFamily}
              options={CODE_FONT_OPTIONS.map(([value, label]) => ({ value, label }))}
            />
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Language</h2>
          <Select<BungieLocale>
            className={styles.selectWide}
            minPopupWidth="13rem"
            value={locale}
            onChange={onLocaleChange}
            options={BUNGIE_LOCALES.map((option) => ({
              value: option.code,
              label: option.label,
            }))}
            aria-label="Manifest language"
          />
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
