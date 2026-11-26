import { useState, type ReactNode } from 'react';
import { bungieAssetUrl } from '../manifest/hash';
import type { ImageScalingMode } from '../types/manifest';
import { useSettingsStore } from '../stores/settings';
import styles from './BungieIcon.module.scss';

const MAX_CACHED_ICON_URLS = 2_000;
const loadedIconUrls = new Set<string>();
const failedIconUrls = new Set<string>();

function rememberIconUrl(cache: Set<string>, url: string): void {
  if (cache.has(url)) return;
  cache.add(url);
  if (cache.size > MAX_CACHED_ICON_URLS) {
    const oldest = cache.values().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export interface BungieIconProps {
  /** Relative Bungie icon path, e.g. /common/destiny2_content/icons/....png */
  icon?: string;
  /** Relative Bungie watermark path rendered over the icon. */
  watermark?: string;
  /**
   * Retained for backwards compatibility with existing call sites.
   * Rarity is rendered on text via `getTierColorVar`, never as an edge on the tile.
   */
  tierType?: number;
  /** Rendered square edge length in pixels. Defaults to 36. */
  size?: number;
  /** Accessible text. Omit when the icon is decorative next to a name. */
  alt?: string;
  className?: string;
  /** Draws Destiny 2's enhanced-weapon arrow plus a warm upward glow. */
  isEnhanced?: boolean;
  /** Per-tile override for the Image scaling setting. */
  imageScaling?: ImageScalingMode;
}

function scalingClassName(mode: ImageScalingMode): string {
  switch (mode) {
    case 'integer':
      return styles.imageInteger ?? '';
    case 'smooth':
      return styles.imageSmooth ?? '';
    default:
      return '';
  }
}

/**
 * Fixed-size Bungie asset tile. The square is sized up front so lazy image
 * loading can never reflow rows, and a broken or missing asset falls back to a
 * quiet glyph instead of a browser error icon.
 */
export function BungieIcon({
  icon,
  watermark,
  size = 36,
  alt,
  className,
  isEnhanced = false,
  imageScaling,
}: BungieIconProps): ReactNode {
  const dimension = Number.isFinite(size) && size > 0 ? size : 36;
  const settingScaling = useSettingsStore((state) => state.imageScaling);
  const scaling = imageScaling ?? settingScaling;

  const [brokenIcon, setBrokenIcon] = useState<string | null>(null);
  const [brokenWatermark, setBrokenWatermark] = useState<string | null>(null);
  const [plainIcon, setPlainIcon] = useState<string | null>(null);
  const [plainWatermark, setPlainWatermark] = useState<string | null>(null);

  const iconSrc = typeof icon === 'string' && icon.trim().length > 0 ? bungieAssetUrl(icon) : null;
  const watermarkSrc =
    typeof watermark === 'string' && watermark.trim().length > 0
      ? bungieAssetUrl(watermark)
      : null;

  const isKnownMissingIcon = iconSrc?.includes('/img/misc/missing_icon_d2.png') ?? false;
  const showIcon = iconSrc !== null && !isKnownMissingIcon && brokenIcon !== iconSrc;
  const showWatermark = watermarkSrc !== null && brokenWatermark !== watermarkSrc;

  const scalingClass = scalingClassName(scaling);
  const imageClass = scalingClass
    ? `${styles.image ?? ''} ${scalingClass}`
    : (styles.image ?? '');

  const frameClass = className
    ? `${styles.frame ?? ''} ${className}`
    : (styles.frame ?? '');

  return (
    <div
      className={frameClass}
      style={{ width: dimension, height: dimension }}
      aria-hidden={alt ? undefined : true}
    >
      {showWatermark ? (
        <img
          className={styles.watermark}
          crossOrigin={plainWatermark === watermarkSrc ? undefined : 'anonymous'}
          src={watermarkSrc}
          alt=""
          loading={
            watermarkSrc !== null && loadedIconUrls.has(watermarkSrc)
              ? 'eager'
              : 'lazy'
          }
          decoding={
            watermarkSrc !== null && loadedIconUrls.has(watermarkSrc)
              ? 'sync'
              : 'async'
          }
          aria-hidden="true"
          onLoad={() => {
            if (watermarkSrc !== null) rememberIconUrl(loadedIconUrls, watermarkSrc);
          }}
          onError={() => {
            if (watermarkSrc === null) return;
            if (plainWatermark !== watermarkSrc) {
              setPlainWatermark(watermarkSrc);
              return;
            }
            rememberIconUrl(failedIconUrls, watermarkSrc);
            setBrokenWatermark((current) =>
              current === watermarkSrc ? current : watermarkSrc,
            );
          }}
        />
      ) : null}

      {showIcon ? (
        <img
          className={imageClass}
          crossOrigin={plainIcon === iconSrc ? undefined : 'anonymous'}
          src={iconSrc}
          alt={alt ?? ''}
          loading={iconSrc !== null && loadedIconUrls.has(iconSrc) ? 'eager' : 'lazy'}
          decoding={iconSrc !== null && loadedIconUrls.has(iconSrc) ? 'sync' : 'async'}
          draggable={false}
          onLoad={() => {
            if (iconSrc !== null) rememberIconUrl(loadedIconUrls, iconSrc);
          }}
          onError={() => {
            if (iconSrc === null) return;
            if (plainIcon !== iconSrc) {
              setPlainIcon(iconSrc);
              return;
            }
            rememberIconUrl(failedIconUrls, iconSrc);
            setBrokenIcon((current) => (current === iconSrc ? current : iconSrc));
          }}
        />
      ) : (
        <span
          className={styles.fallback}
          role={alt ? 'img' : undefined}
          aria-label={alt || undefined}
        >
          <svg
            className={styles.glyph}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M8 2.25 13.75 8 8 13.75 2.25 8Z" />
            <path d="M8 5.25 10.75 8 8 10.75 5.25 8Z" opacity={0.45} />
          </svg>
        </span>
      )}

      {isEnhanced ? (
        <>
          <span className={styles.enhancedGlow} aria-hidden="true" />
          <span className={styles.enhancedBadge} aria-hidden="true">
            <svg
              className={styles.enhancedArrow}
              viewBox="0 0 8 32"
              preserveAspectRatio="xMinYMax meet"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3.2 0.5 6.4 6.6H4.35V32H2.05V6.6H0Z" />
            </svg>
          </span>
        </>
      ) : null}
    </div>
  );
}
