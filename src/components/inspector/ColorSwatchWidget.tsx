import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CopyIcon } from '../../ui/Icons';
import { Popover } from '../../ui/Popover';
import styles from './ColorSwatchWidget.module.scss';

export interface ColorSwatchWidgetProps {
  /** Red channel, 0–255. */
  r: number;
  /** Green channel, 0–255. */
  g: number;
  /** Blue channel, 0–255. */
  b: number;
  /** Alpha, normalised to 0–1. */
  a: number;
  onCopy: (text: string, label: string) => void;
}

interface NormalizedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface FormatRow {
  key: string;
  label: string;
  value: string;
}

interface ChannelRow {
  key: string;
  label: string;
  display: string;
  fillPercent: number;
  fill: string;
}

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function normalizeAlpha(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

function toHexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function shortAlpha(value: number): string {
  if (value >= 1) return '1';
  if (value <= 0) return '0';
  return String(Number(value.toFixed(3)));
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

    if (max === red) {
      hue = (green - blue) / delta + (green < blue ? 6 : 0);
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }

    hue /= 6;
  }

  return {
    h: Math.round(hue * 360) % 360,
    s: Math.round(saturation * 100),
    l: Math.round(lightness * 100),
  };
}

export function ColorSwatchWidget({
  r,
  g,
  b,
  a,
  onCopy,
}: ColorSwatchWidgetProps): ReactNode {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const color = useMemo<NormalizedColor>(
    () => ({
      r: clampByte(r),
      g: clampByte(g),
      b: clampByte(b),
      a: normalizeAlpha(a),
    }),
    [r, g, b, a],
  );

  const formats = useMemo<FormatRow[]>(() => {
    const hex = `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
    const hexWithAlpha =
      color.a < 1 ? `${hex}${toHexByte(Math.round(color.a * 255))}` : hex;
    const hsl = rgbToHsl(color.r, color.g, color.b);
    const alphaText = shortAlpha(color.a);

    return [
      { key: 'hex', label: 'HEX', value: hexWithAlpha },
      { key: 'rgb', label: 'RGB', value: `rgb(${color.r}, ${color.g}, ${color.b})` },
      {
        key: 'rgba',
        label: 'RGBA',
        value: `rgba(${color.r}, ${color.g}, ${color.b}, ${alphaText})`,
      },
      { key: 'hsl', label: 'HSL', value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
      {
        key: 'float',
        label: 'Float RGBA',
        value: `${(color.r / 255).toFixed(3)}, ${(color.g / 255).toFixed(3)}, ${(
          color.b / 255
        ).toFixed(3)}, ${color.a.toFixed(3)}`,
      },
    ];
  }, [color]);

  const channels = useMemo<ChannelRow[]>(() => {
    const alphaFill = `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.max(
      0.12,
      color.a,
    )})`;
    return [
      {
        key: 'r',
        label: 'R',
        display: String(color.r),
        fillPercent: (color.r / 255) * 100,
        fill: `rgb(${color.r} 0 0)`,
      },
      {
        key: 'g',
        label: 'G',
        display: String(color.g),
        fillPercent: (color.g / 255) * 100,
        fill: `rgb(0 ${color.g} 0)`,
      },
      {
        key: 'b',
        label: 'B',
        display: String(color.b),
        fillPercent: (color.b / 255) * 100,
        fill: `rgb(0 0 ${color.b})`,
      },
      {
        key: 'a',
        label: 'A',
        display: color.a.toFixed(2),
        fillPercent: color.a * 100,
        fill: alphaFill,
      },
    ];
  }, [color]);

  const rgba = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
  const hexLabel =
    color.a < 1
      ? `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}${toHexByte(
          Math.round(color.a * 255),
        )}`
      : `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;

  const previewCellStyle: CSSProperties = { backgroundColor: rgba };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Color ${hexLabel}. Open color inspector`}
        title={`${rgba} — open color inspector`}
      >
        <span className={styles.swatch} aria-hidden="true">
          <span className={styles.swatchFill} style={{ backgroundColor: rgba }} />
        </span>
        <span className={styles.hexLabel}>{hexLabel}</span>
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label="Color inspector"
        width="18rem"
      >
        <div className={styles.popContent}>
          <div className={styles.previewGrid} role="img" aria-label={`Color preview ${hexLabel}`}>
            <div className={`${styles.previewCell} ${styles.previewDark}`}>
              <span className={styles.previewFill} style={previewCellStyle} />
              <span className={styles.previewCaption}>Dark</span>
            </div>
            <div className={`${styles.previewCell} ${styles.previewChecker}`}>
              <span className={styles.previewFill} style={previewCellStyle} />
              <span className={styles.previewCaption}>Checker</span>
            </div>
            <div className={`${styles.previewCell} ${styles.previewLight}`}>
              <span className={styles.previewFill} style={previewCellStyle} />
              <span className={styles.previewCaption}>Light</span>
            </div>
          </div>

          <div className={styles.formatList}>
            {formats.map((row) => (
              <div key={row.key} className={styles.formatRow}>
                <span className={styles.formatLabel}>{row.label}</span>
                <span className={styles.formatValue} title={row.value}>
                  {row.value}
                </span>
                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={() => onCopy(row.value, `Copied ${row.label}`)}
                  title={`Copy ${row.label}: ${row.value}`}
                  aria-label={`Copy ${row.label}`}
                >
                  <CopyIcon size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.channelList}>
            {channels.map((channel) => (
              <div key={channel.key} className={styles.channelRow}>
                <span className={styles.channelLabel}>{channel.label}</span>
                <span className={styles.channelTrack}>
                  <span
                    className={styles.channelFill}
                    style={{
                      width: `${channel.fillPercent}%`,
                      backgroundColor: channel.fill,
                    }}
                  />
                </span>
                <span className={styles.channelValue}>{channel.display}</span>
              </div>
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
