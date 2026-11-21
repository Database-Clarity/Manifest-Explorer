import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ImageScalingMode } from '../../types/manifest';
import { CloseIcon, CopyIcon, ExternalLinkIcon, ImageIcon } from '../../ui/Icons';
import styles from './ImageLightbox.module.scss';

export interface ImageLightboxProps {
  url: string;
  path: string;
  defaultScaling: ImageScalingMode;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
}

type BackdropMode = 'dark' | 'checker' | 'light';
type ZoomSelection = 'fit' | 1 | 2 | 3 | 4 | 6;

interface LoadedAsset {
  image: HTMLImageElement;
  width: number;
  height: number;
  /** False when the CORS-enabled request failed and a plain image was used. */
  corsSafe: boolean;
}

interface DisplaySize {
  width: number;
  height: number;
  scale: number;
}

const ZOOM_LEVELS: readonly (1 | 2 | 3 | 4 | 6)[] = [1, 2, 3, 4, 6];
const MAX_CANVAS_SOURCE_WIDTH = 1024;
const MAX_OUTPUT_DIMENSION = 4096;
const MAX_OUTPUT_PIXELS = 8_000_000;
const STAGE_PADDING = 32;

const SCALING_OPTIONS: ReadonlyArray<{
  value: ImageScalingMode;
  label: string;
  title: string;
}> = [
  {
    value: 'sharp',
    label: 'Sharp (Lanczos)',
    title: 'Lanczos-3 resampling on canvas; falls back to CSS for large or CORS-limited images',
  },
  {
    value: 'integer',
    label: 'Integer (Pixelated)',
    title: 'Nearest-neighbour integer scaling with exact whole-pixel blocks',
  },
  {
    value: 'smooth',
    label: 'Smooth',
    title: 'Browser-standard smooth interpolation',
  },
];

const BACKDROP_OPTIONS: ReadonlyArray<{ value: BackdropMode; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'checker', label: 'Checker' },
  { value: 'light', label: 'Light' },
];

/** Lanczos-3 windowed sinc kernel. */
function lanczos3(x: number): number {
  if (x === 0) return 1;
  const abs = Math.abs(x);
  if (abs >= 3) return 0;
  const pix = Math.PI * x;
  return (3 * Math.sin(pix) * Math.sin(pix / 3)) / (pix * pix);
}

interface Contribution {
  start: number;
  weights: Float32Array;
}

/** Precompute normalised filter taps for each destination sample. */
function buildContributions(srcLength: number, dstLength: number): Contribution[] {
  const ratio = srcLength / dstLength;
  const filterScale = Math.max(1, ratio);
  const support = 3 * filterScale;
  const contributions: Contribution[] = [];

  for (let dst = 0; dst < dstLength; dst += 1) {
    const center = (dst + 0.5) * ratio;
    const start = Math.max(0, Math.floor(center - support));
    const end = Math.min(srcLength, Math.ceil(center + support));
    const weights = new Float32Array(Math.max(1, end - start));
    let total = 0;

    for (let src = start; src < end; src += 1) {
      const weight = lanczos3((src + 0.5 - center) / filterScale);
      weights[src - start] = weight;
      total += weight;
    }

    if (total !== 0) {
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] = (weights[i] ?? 0) / total;
      }
    }

    contributions.push({ start, weights });
  }

  return contributions;
}

/**
 * Horizontal pass. RGB is premultiplied by alpha before filtering so
 * transparent edges do not bleed dark or white halos into the result.
 */
function resampleHorizontal(
  src: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
): Float32Array {
  const out = new Float32Array(dstWidth * srcHeight * 4);
  const contributions = buildContributions(srcWidth, dstWidth);

  for (let y = 0; y < srcHeight; y += 1) {
    const rowOffset = y * srcWidth * 4;

    for (let x = 0; x < dstWidth; x += 1) {
      const contribution = contributions[x];
      if (!contribution) continue;
      const { start, weights } = contribution;
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let i = 0; i < weights.length; i += 1) {
        const px = rowOffset + (start + i) * 4;
        const weight = weights[i] ?? 0;
        const a = (src[px + 3] ?? 0) / 255;
        red += (src[px] ?? 0) * a * weight;
        green += (src[px + 1] ?? 0) * a * weight;
        blue += (src[px + 2] ?? 0) * a * weight;
        alpha += (src[px + 3] ?? 0) * weight;
      }

      const outOffset = (y * dstWidth + x) * 4;
      out[outOffset] = red;
      out[outOffset + 1] = green;
      out[outOffset + 2] = blue;
      out[outOffset + 3] = alpha;
    }
  }

  return out;
}

/** Vertical pass, then unpremultiply back to straight RGBA. */
function resampleVertical(
  src: Float32Array,
  width: number,
  srcHeight: number,
  dstHeight: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * dstHeight * 4);
  const contributions = buildContributions(srcHeight, dstHeight);

  for (let y = 0; y < dstHeight; y += 1) {
    const contribution = contributions[y];
    if (!contribution) continue;
    const { start, weights } = contribution;

    for (let x = 0; x < width; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      for (let i = 0; i < weights.length; i += 1) {
        const px = ((start + i) * width + x) * 4;
        const weight = weights[i] ?? 0;
        red += (src[px] ?? 0) * weight;
        green += (src[px + 1] ?? 0) * weight;
        blue += (src[px + 2] ?? 0) * weight;
        alpha += (src[px + 3] ?? 0) * weight;
      }

      const outOffset = (y * width + x) * 4;
      const alphaFraction = alpha / 255;
      out[outOffset] =
        alphaFraction > 0 ? Math.round(red / alphaFraction) : 0;
      out[outOffset + 1] =
        alphaFraction > 0 ? Math.round(green / alphaFraction) : 0;
      out[outOffset + 2] =
        alphaFraction > 0 ? Math.round(blue / alphaFraction) : 0;
      out[outOffset + 3] = Math.round(alpha);
    }
  }

  return out;
}

function resampleLanczos3(
  source: ImageData,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  const horizontal = resampleHorizontal(
    source.data,
    source.width,
    source.height,
    targetWidth,
  );
  const data = resampleVertical(horizontal, targetWidth, source.height, targetHeight);
  const pixels = new Uint8ClampedArray(data.length);
  pixels.set(data);
  return new ImageData(pixels, targetWidth, targetHeight);
}

function readDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

export function ImageLightbox({
  url,
  path,
  defaultScaling,
  onClose,
  onCopy,
}: ImageLightboxProps): ReactNode {
  const [mode, setMode] = useState<ImageScalingMode>(defaultScaling);
  const [zoom, setZoom] = useState<ZoomSelection>('fit');
  const [exactDevicePixels, setExactDevicePixels] = useState(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('dark');
  const [asset, setAsset] = useState<LoadedAsset | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sharpResult, setSharpResult] = useState<'idle' | 'ready' | 'fallback'>('idle');
  const [view, setView] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const dpr = readDevicePixelRatio();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    dialogRef.current?.focus({ preventScroll: true });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    setZoom('fit');
  }, [url]);

  useEffect(() => {
    setMode(defaultScaling);
  }, [defaultScaling]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = (): void => {
      setView({
        width: Math.max(1, stage.clientWidth - STAGE_PADDING),
        height: Math.max(1, stage.clientHeight - STAGE_PADDING),
      });
    };

    update();
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(stage);
    window.addEventListener('resize', update);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAsset(null);
    setLoadError(false);
    setSharpResult('idle');

    const settle = (image: HTMLImageElement, corsSafe: boolean): void => {
      if (cancelled) return;
      setAsset({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        corsSafe,
      });
    };

    const corsImage = new Image();
    corsImage.crossOrigin = 'anonymous';
    corsImage.decoding = 'async';
    corsImage.onload = () => settle(corsImage, true);
    corsImage.onerror = () => {
      if (cancelled) return;
      const plainImage = new Image();
      plainImage.decoding = 'async';
      plainImage.onload = () => settle(plainImage, false);
      plainImage.onerror = () => {
        if (cancelled) return;
        setLoadError(true);
      };
      plainImage.src = url;
    };
    corsImage.src = url;

    return () => {
      cancelled = true;
      corsImage.onload = null;
      corsImage.onerror = null;
    };
  }, [url]);

  const display = useMemo<DisplaySize>(() => {
    if (!asset || asset.width <= 0 || asset.height <= 0) {
      return { width: 0, height: 0, scale: 1 };
    }

    const fitScale =
      view.width > 0 && view.height > 0
        ? Math.min(view.width / asset.width, view.height / asset.height)
        : 1;
    const baseScale =
      zoom === 'fit'
        ? mode === 'integer'
          ? Math.max(1, Math.floor(fitScale))
          : fitScale
        : zoom;

    const scale = mode === 'integer' && exactDevicePixels ? baseScale / dpr : baseScale;
    return {
      width: Math.max(1, asset.width * scale),
      height: Math.max(1, asset.height * scale),
      scale: baseScale,
    };
  }, [asset, view.width, view.height, zoom, mode, exactDevicePixels, dpr]);

  useEffect(() => {
    if (mode !== 'sharp' || !asset) return;

    if (!asset.corsSafe || asset.width > MAX_CANVAS_SOURCE_WIDTH) {
      setSharpResult('fallback');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const targetWidth = Math.max(1, Math.round(display.width * dpr));
    const targetHeight = Math.max(1, Math.round(display.height * dpr));

    if (
      targetWidth > MAX_OUTPUT_DIMENSION ||
      targetHeight > MAX_OUTPUT_DIMENSION ||
      targetWidth * targetHeight > MAX_OUTPUT_PIXELS
    ) {
      setSharpResult('fallback');
      return;
    }

    const outContext = canvas.getContext('2d');
    if (!outContext) {
      setSharpResult('fallback');
      return;
    }

    try {
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      if (targetWidth === asset.width && targetHeight === asset.height) {
        outContext.imageSmoothingEnabled = false;
        outContext.clearRect(0, 0, targetWidth, targetHeight);
        outContext.drawImage(asset.image, 0, 0);
        setSharpResult('ready');
        return;
      }

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = asset.width;
      sourceCanvas.height = asset.height;
      const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!sourceContext) {
        setSharpResult('fallback');
        return;
      }

      sourceContext.clearRect(0, 0, asset.width, asset.height);
      sourceContext.drawImage(asset.image, 0, 0);
      const sourceData = sourceContext.getImageData(0, 0, asset.width, asset.height);
      const resampled = resampleLanczos3(sourceData, targetWidth, targetHeight);

      outContext.putImageData(resampled, 0, 0);
      setSharpResult('ready');
    } catch {
      // Tainted canvas or an unsupported ImageData path: use the <img> fallback.
      setSharpResult('fallback');
    }
  }, [mode, asset, display.width, display.height, dpr]);

  const stageClass =
    backdrop === 'dark'
      ? styles.stageDark
      : backdrop === 'light'
        ? styles.stageLight
        : styles.stageChecker;

  const imageStyle: CSSProperties = {
    width: display.width,
    height: display.height,
    imageRendering:
      mode === 'integer'
        ? 'pixelated'
        : mode === 'sharp' && sharpResult === 'fallback'
          ? 'crisp-edges'
          : 'auto',
  };

  const canvasStyle: CSSProperties = {
    width: display.width,
    height: display.height,
  };

  const scaleLabel =
    zoom === 'fit'
      ? `Fit ${display.scale.toFixed(2)}×`
      : `${zoom}×`;

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.card} ref={dialogRef} tabIndex={-1}>
        <div className={styles.header}>
          <span className={styles.title}>
            <ImageIcon size={14} />
            <span className={styles.path} title={path}>
              {path}
            </span>
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close image viewer"
            title="Close (Esc)"
          >
            <CloseIcon size={14} />
          </button>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.group}>
            <span className={styles.groupLabel}>Scaling</span>
            <div className={styles.segmented} role="group" aria-label="Image scaling mode">
              {SCALING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.segment} ${
                    mode === option.value ? styles.segmentActive : ''
                  }`}
                  onClick={() => setMode(option.value)}
                  aria-pressed={mode === option.value}
                  title={option.title}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.group}>
            <span className={styles.groupLabel}>Zoom</span>
            <div className={styles.zoomGroup} role="group" aria-label="Zoom level">
              <button
                type="button"
                className={`${styles.zoomBtn} ${
                  zoom === 'fit' ? styles.zoomBtnActive : ''
                }`}
                onClick={() => setZoom('fit')}
                aria-pressed={zoom === 'fit'}
                title="Fit image to the viewer"
              >
                Fit
              </button>
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`${styles.zoomBtn} ${
                    zoom === level ? styles.zoomBtnActive : ''
                  }`}
                  onClick={() => setZoom(level)}
                  aria-pressed={zoom === level}
                  title={`${level}× zoom`}
                >
                  {level}×
                </button>
              ))}
            </div>
          </div>

          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={exactDevicePixels}
              onChange={(event) => setExactDevicePixels(event.target.checked)}
            />
            <span>Exact device pixels (1:1 DPR)</span>
          </label>

          <div className={styles.group}>
            <span className={styles.groupLabel}>Backdrop</span>
            <div className={styles.segmented} role="group" aria-label="Preview backdrop">
              {BACKDROP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`${styles.segment} ${
                    backdrop === option.value ? styles.segmentActive : ''
                  }`}
                  onClick={() => setBackdrop(option.value)}
                  aria-pressed={backdrop === option.value}
                  title={`${option.label} backdrop`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          ref={stageRef}
          className={`${styles.stage} ${stageClass}`}
          data-scaling={mode}
          data-backdrop={backdrop}
        >
          {loadError ? (
            <p className={styles.message}>This image could not be loaded.</p>
          ) : !asset ? (
            <p className={styles.message}>Loading image…</p>
          ) : (
            <>
              {mode === 'sharp' && (
                <canvas
                  ref={canvasRef}
                  className={styles.canvas}
                  style={{
                    ...canvasStyle,
                    display: sharpResult === 'ready' ? 'block' : 'none',
                  }}
                  aria-hidden="true"
                />
              )}
              {(mode !== 'sharp' || sharpResult !== 'ready') && (
                <img
                  src={url}
                  alt=""
                  className={styles.image}
                  style={imageStyle}
                  draggable={false}
                />
              )}
            </>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.meta}>
            <span>
              Original{' '}
              <span className={styles.metaValue}>
                {asset ? `${asset.width} × ${asset.height}` : '—'}
              </span>
            </span>
            <span>
              {scaleLabel}{' '}
              <span className={styles.metaValue}>
                {Math.round(display.width)} × {Math.round(display.height)} CSS px
              </span>
            </span>
            <span>
              {Math.round(display.width * dpr)} × {Math.round(display.height * dpr)} device px
            </span>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onCopy(url, 'Copied image URL')}
              title="Copy image URL"
            >
              <CopyIcon size={12} />
              Copy URL
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.actionBtn}
            >
              <ExternalLinkIcon size={12} />
              Open original
            </a>
            <button type="button" className={styles.actionBtn} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
