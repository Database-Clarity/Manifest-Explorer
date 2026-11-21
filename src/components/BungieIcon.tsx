import { useState, type ReactNode } from 'react';
import { bungieAssetUrl } from '../manifest/hash';
import styles from './BungieIcon.module.scss';

export interface BungieIconProps {
  /** Relative Bungie icon path, e.g. /common/destiny2_content/icons/....png */
  icon?: string;
  /** Relative Bungie watermark path rendered behind the icon. */
  watermark?: string;
  /** Destiny item tier: 6 Exotic, 5 Legendary, 4 Rare, 3 Uncommon, 2 Common. */
  tierType?: number;
  /** Rendered square edge length in pixels. Defaults to 36. */
  size?: number;
  /** Accessible text. Omit when the icon is decorative next to a name. */
  alt?: string;
  className?: string;
}

function tierClassName(tierType: number | undefined): string {
  switch (tierType) {
    case 6:
      return styles.tierExotic ?? '';
    case 5:
      return styles.tierLegendary ?? '';
    case 4:
      return styles.tierRare ?? '';
    case 3:
      return styles.tierUncommon ?? '';
    case 2:
      return styles.tierCommon ?? '';
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
  tierType,
  size = 36,
  alt,
  className,
}: BungieIconProps): ReactNode {
  const dimension = Number.isFinite(size) && size > 0 ? size : 36;

  const [brokenIcon, setBrokenIcon] = useState<string | null>(null);
  const [brokenWatermark, setBrokenWatermark] = useState<string | null>(null);

  const iconSrc = typeof icon === 'string' && icon.trim().length > 0 ? bungieAssetUrl(icon) : null;
  const watermarkSrc =
    typeof watermark === 'string' && watermark.trim().length > 0
      ? bungieAssetUrl(watermark)
      : null;

  const showIcon = iconSrc !== null && brokenIcon !== iconSrc;
  const showWatermark = watermarkSrc !== null && brokenWatermark !== watermarkSrc;
  const tierEdgeClass = tierClassName(tierType);

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
          src={watermarkSrc}
          alt=""
          loading="lazy"
          decoding="async"
          aria-hidden="true"
          onError={() => setBrokenWatermark(watermarkSrc)}
        />
      ) : null}

      {showIcon ? (
        <img
          className={styles.image}
          src={iconSrc}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBrokenIcon(iconSrc)}
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

      {tierEdgeClass ? (
        <span className={`${styles.tierEdge ?? ''} ${tierEdgeClass}`} aria-hidden="true" />
      ) : null}
    </div>
  );
}
