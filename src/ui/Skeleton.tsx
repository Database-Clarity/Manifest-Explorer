/// <reference types="vite/client" />
import type { CSSProperties } from 'react';
import styles from './Skeleton.module.scss';

export interface SkeletonProps {
  /** CSS width value. Defaults to filling the parent. */
  width?: number | string;
  /** CSS height value. Defaults to one line of text. */
  height?: number | string;
  /** CSS border radius value. Clarity skeletons stay at 4px or less. */
  radius?: number | string;
  className?: string;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = '0.25rem',
  className,
}: SkeletonProps) {
  const style: CSSProperties = {
    width,
    height,
    borderRadius: radius,
  };

  return (
    <span
      className={className ? `${styles.skeleton ?? ''} ${className}` : styles.skeleton ?? ''}
      style={style}
      aria-hidden="true"
    />
  );
}
