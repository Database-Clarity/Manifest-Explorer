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
import type { RgbaImage } from '../../utils/upscale';
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImageIcon,
} from '../../ui/Icons';
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
/** Lightbox-specific scaling modes. `original` is the browser's own rendering. */
type ScalingMode = 'anime4k' | 'perk-sdf' | 'mitchell' | 'nearest' | 'original';

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

type FeedbackKind = 'copied' | 'copy-unavailable' | 'export-unavailable';
type ExportAction = 'copy' | 'download' | 'open';

interface PngExport {
  blob: Blob;
  filename: string;
}

const ZOOM_LEVELS: readonly (1 | 2 | 3 | 4 | 6)[] = [1, 2, 3, 4, 6];
const MAX_CANVAS_SOURCE_WIDTH = 1024;
const MAX_OUTPUT_DIMENSION = 4096;
const MAX_OUTPUT_PIXELS = 8_000_000;
/** Cap the internal resample buffer at 4x native so Fit mode stays instant. */
const MAX_UPSCALE_SCALE = 4;
const STAGE_PADDING = 32;
const FEEDBACK_MS = 1_800;
const DOWNLOAD_URL_REVOKE_MS = 1_000;
const OPEN_TAB_URL_REVOKE_MS = 60_000;
const AUTO_UPSCALE_ICON_MAX_DIMENSION = 256;
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

type UpscaleModule = typeof import('../../utils/upscale');
type Anime4kModule = typeof import('../../utils/anime4k');
type PerkVectorModule = typeof import('../../utils/perkVector');

let upscaleModulePromise: Promise<UpscaleModule> | undefined;
let anime4kModulePromise: Promise<Anime4kModule> | undefined;
let perkVectorModulePromise: Promise<PerkVectorModule> | undefined;

function loadUpscaleModule(): Promise<UpscaleModule> {
  return (upscaleModulePromise ??= import('../../utils/upscale'));
}

function loadAnime4kModule(): Promise<Anime4kModule> {
  return (anime4kModulePromise ??= import('../../utils/anime4k'));
}

function loadPerkVectorModule(): Promise<PerkVectorModule> {
  return (perkVectorModulePromise ??= import('../../utils/perkVector'));
}

const SCALING_OPTIONS: ReadonlyArray<{
  value: ScalingMode;
  label: string;
  title: string;
}> = [
  {
    value: 'anime4k',
    label: 'Anime4K',
    title:
      'Anime4K 3D-AA WebGL2 CNN: silky diagonals and clean detail with zero JPEG ringing (falls back to FSR EASU 2× cascade without WebGL2)',
  },
  {
    value: 'perk-sdf',
    label: 'Perk Vector',
    title:
      'SDF vector-contour reconstruction for flat monochrome perk/mod/ability icons (transparent PNG or opaque JPEG)',
  },
  {
    value: 'mitchell',
    label: 'Smooth',
    title: 'Mitchell-Netravali (B=1/3, C=1/3) cubic: balanced and ring-free',
  },
  {
    value: 'nearest',
    label: 'Pixelated',
    title: 'Nearest-neighbour integer scaling with exact whole-pixel blocks',
  },
  {
    value: 'original',
    label: 'Original',
    title: 'Browser-standard rendering (original quality)',
  },
];

const BACKDROP_OPTIONS: ReadonlyArray<{ value: BackdropMode; label: string }> = [
  { value: 'dark', label: 'Dark' },
  { value: 'checker', label: 'Checker' },
  { value: 'light', label: 'Light' },
];

/** Map the sitewide icon-scaling setting onto a lightbox mode. */
function toScalingMode(defaultScaling: ImageScalingMode): ScalingMode {
  switch (defaultScaling) {
    case 'integer':
      return 'nearest';
    case 'smooth':
      return 'mitchell';
    case 'sharp':
    default:
      return 'anime4k';
  }
}

/** Canvas-resampled modes (the rest render the raw <img>). */
function isCanvasMode(mode: ScalingMode): mode is 'anime4k' | 'perk-sdf' | 'mitchell' {
  return mode === 'anime4k' || mode === 'perk-sdf' || mode === 'mitchell';
}

/** Auto-run the heavier engines for compact, icon-shaped assets only. */
function isEligibleAutoUpscaleIcon(asset: LoadedAsset): boolean {
  const { width, height } = asset;
  return (
    width > 0 &&
    height > 0 &&
    width <= AUTO_UPSCALE_ICON_MAX_DIMENSION &&
    height <= AUTO_UPSCALE_ICON_MAX_DIMENSION &&
    Math.min(width, height) / Math.max(width, height) >= 0.5
  );
}

function readDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
}

/** Build a filesystem-safe basename from the manifest asset path. */
function exportFilenameBase(path: string): string {
  const basename = path.split(/[\\/]/).pop() ?? 'image';
  const withoutQuery = basename.split(/[?#]/)[0] ?? basename;
  const withoutExtension = withoutQuery.replace(/\.[^.]*$/, '');
  const cleaned = withoutExtension
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return cleaned || 'image';
}

function buildExportFilename(
  path: string,
  mode: ScalingMode,
  width: number,
  height: number,
): string {
  const base = exportFilenameBase(path);
  return mode === 'original'
    ? `${base}-${width}x${height}.png`
    : `${base}-${mode}-${width}x${height}.png`;
}

/** Keep offscreen exports inside the same bounds the preview canvas respects. */
function clampExportSize(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const dimensionScale = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(safeWidth, safeHeight));
  const pixelScale = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / (safeWidth * safeHeight)));
  const scale = Math.min(dimensionScale, pixelScale);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error('PNG export is not supported.'));
      return;
    }

    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('PNG export failed.'));
        }
      }, 'image/png');
    } catch (error) {
      reject(error instanceof Error ? error : new Error('PNG export failed.'));
    }
  });
}

async function writePngToClipboard(blob: Blob): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined') return false;
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.write !== 'function') return false;

  try {
    await clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), DOWNLOAD_URL_REVOKE_MS);
}

function openBlobInNewTab(blob: Blob): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Keep the URL alive long enough for the new tab to finish loading even if
  // the lightbox closes immediately.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), OPEN_TAB_URL_REVOKE_MS);
}

/** Visible, enabled controls inside the lightbox card, in tab order. */
function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

export function ImageLightbox({
  url,
  path,
  defaultScaling,
  onClose,
  onCopy,
}: ImageLightboxProps): ReactNode {
  const [mode, setMode] = useState<ScalingMode>(() => toScalingMode(defaultScaling));
  const [userSelectedMode, setUserSelectedMode] = useState(false);
  const [zoom, setZoom] = useState<ZoomSelection>('fit');
  const [exactDevicePixels, setExactDevicePixels] = useState(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>('dark');
  const [asset, setAsset] = useState<LoadedAsset | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [upscaleResult, setUpscaleResult] = useState<'idle' | 'ready' | 'fallback'>('idle');
  const [view, setView] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);
  const [busyAction, setBusyAction] = useState<ExportAction | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const dpr = readDevicePixelRatio();

  useEffect(() => {
    // Remember the trigger so closing the viewer can hand focus back to it.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    dialogRef.current?.focus({ preventScroll: true });

    const handleFocusTrap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      const activeInside = active instanceof Node && dialog.contains(active);
      if (event.shiftKey) {
        if (!activeInside || active === first || active === dialog) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        }
        return;
      }

      if (!activeInside || active === last || active === dialog) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleFocusTrap, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleFocusTrap, true);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
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
    setFeedback(null);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, [url]);

  useEffect(() => {
    setMode(toScalingMode(defaultScaling));
    setUserSelectedMode(false);
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
    setUpscaleResult('idle');

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
        ? mode === 'nearest'
          ? Math.max(1, Math.floor(fitScale))
          : fitScale
        : zoom;

    const scale = mode === 'nearest' && exactDevicePixels ? baseScale / dpr : baseScale;
    return {
      width: Math.max(1, asset.width * scale),
      height: Math.max(1, asset.height * scale),
      scale: baseScale,
    };
  }, [asset, view.width, view.height, zoom, mode, exactDevicePixels, dpr]);

  useEffect(() => {
    if (!asset) return;
    if (!isCanvasMode(mode)) {
      setUpscaleResult('idle');
      return;
    }

    if (!asset.corsSafe || asset.width > MAX_CANVAS_SOURCE_WIDTH) {
      setUpscaleResult('fallback');
      return;
    }

    // Keep the lightbox shell and plain-image path small. The preference can
    // still auto-upscale compact icons; other assets load an engine only after
    // the user explicitly selects a canvas-based scaling mode.
    if (!userSelectedMode && !isEligibleAutoUpscaleIcon(asset)) {
      setUpscaleResult('fallback');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Clamp the internal resample buffer to at most 4x native so Fit mode on a
    // small icon resamples to a handful of pixels (e.g. 384x384), never a
    // 1728x1728 device-pixel grid that freezes the main thread. The canvas is
    // still displayed at the requested CSS size via its inline style.
    const targetWidth = Math.min(
      Math.max(1, Math.round(display.width * dpr)),
      asset.width * MAX_UPSCALE_SCALE,
    );
    const targetHeight = Math.min(
      Math.max(1, Math.round(display.height * dpr)),
      asset.height * MAX_UPSCALE_SCALE,
    );

    if (
      targetWidth > MAX_OUTPUT_DIMENSION ||
      targetHeight > MAX_OUTPUT_DIMENSION ||
      targetWidth * targetHeight > MAX_OUTPUT_PIXELS
    ) {
      setUpscaleResult('fallback');
      return;
    }

    setUpscaleResult('fallback');
    let cancelled = false;
    const loadModules: Promise<
      readonly [UpscaleModule, Anime4kModule | null, PerkVectorModule | null]
    > =
      mode === 'anime4k'
        ? Promise.all([loadUpscaleModule(), loadAnime4kModule()]).then(
            ([upscaleModule, anime4kModule]) => [upscaleModule, anime4kModule, null] as const,
          )
        : mode === 'perk-sdf'
          ? Promise.all([loadUpscaleModule(), loadPerkVectorModule()]).then(
              ([upscaleModule, perkVectorModule]) => [upscaleModule, null, perkVectorModule] as const,
            )
          : loadUpscaleModule().then((upscaleModule) => [upscaleModule, null, null] as const);

    void loadModules
      .then(([upscaleModule, anime4kModule, perkVectorModule]) => {
        if (cancelled) return;
        const outContext = canvas.getContext('2d');
        if (!outContext) {
          setUpscaleResult('fallback');
          return;
        }

        try {
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          if (targetWidth === asset.width && targetHeight === asset.height) {
            outContext.imageSmoothingEnabled = false;
            outContext.clearRect(0, 0, targetWidth, targetHeight);
            outContext.drawImage(asset.image, 0, 0);
            setUpscaleResult('ready');
            return;
          }

          const sourceCanvas = document.createElement('canvas');
          sourceCanvas.width = asset.width;
          sourceCanvas.height = asset.height;
          const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
          if (!sourceContext) {
            setUpscaleResult('fallback');
            return;
          }

          sourceContext.clearRect(0, 0, asset.width, asset.height);
          sourceContext.drawImage(asset.image, 0, 0);
          const sourceData = sourceContext.getImageData(0, 0, asset.width, asset.height);
          const source: RgbaImage = {
            data: sourceData.data,
            width: asset.width,
            height: asset.height,
          };

          let resampled: RgbaImage;
          if (mode === 'anime4k') {
            // WebGL2 CNN, falling back to the CPU EASU 2x cascade without WebGL2.
            resampled =
              anime4kModule?.upscaleAnime4k(source, targetWidth, targetHeight) ??
              upscaleModule.upscaleEasu(source, targetWidth, targetHeight);
          } else if (mode === 'perk-sdf') {
            resampled =
              perkVectorModule?.upscalePerkVector(source, targetWidth, targetHeight) ??
              upscaleModule.upscaleMitchell(source, targetWidth, targetHeight);
          } else {
            resampled = upscaleModule.upscale(source, targetWidth, targetHeight, mode);
          }

          outContext.putImageData(
            new ImageData(
              resampled.data as Uint8ClampedArray<ArrayBuffer>,
              targetWidth,
              targetHeight,
            ),
            0,
            0,
          );
          setUpscaleResult('ready');
        } catch {
          // Tainted canvas or an unsupported ImageData path: use the <img> fallback.
          setUpscaleResult('fallback');
        }
      })
      .catch(() => {
        if (!cancelled) setUpscaleResult('fallback');
      });

    return () => {
      cancelled = true;
    };
  }, [mode, asset, display.width, display.height, dpr, userSelectedMode]);

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
      mode === 'nearest'
        ? 'pixelated'
        : isCanvasMode(mode) && upscaleResult === 'fallback'
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

  const showFeedback = (kind: FeedbackKind): void => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setFeedback(kind);
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setFeedback(null);
    }, FEEDBACK_MS);
  };

  const createPngExport = async (): Promise<PngExport> => {
    if (!asset) {
      throw new Error('The image has not loaded yet.');
    }

    const canvas = canvasRef.current;
    if (
      isCanvasMode(mode) &&
      upscaleResult === 'ready' &&
      canvas &&
      canvas.width > 0 &&
      canvas.height > 0
    ) {
      const blob = await canvasToPngBlob(canvas);
      return {
        blob,
        filename: buildExportFilename(path, mode, canvas.width, canvas.height),
      };
    }

    // Original mode exports native pixels; pixelated and fallback modes export
    // the current on-screen size so the PNG matches what the lightbox shows.
    const size =
      mode === 'original'
        ? { width: asset.width, height: asset.height }
        : clampExportSize(display.width * dpr, display.height * dpr);

    const offscreen = document.createElement('canvas');
    offscreen.width = size.width;
    offscreen.height = size.height;
    const context = offscreen.getContext('2d');
    if (!context) {
      throw new Error('Could not create an export canvas.');
    }

    if (mode !== 'original') {
      context.imageSmoothingEnabled = false;
    }
    context.clearRect(0, 0, size.width, size.height);
    context.drawImage(asset.image, 0, 0, size.width, size.height);

    const blob = await canvasToPngBlob(offscreen);
    return {
      blob,
      filename: buildExportFilename(path, mode, size.width, size.height),
    };
  };

  const canExport = asset !== null && !loadError && asset.width > 0 && asset.height > 0;
  const actionsDisabled = !canExport || busyAction !== null;
  const copyLabel =
    feedback === 'copied'
      ? 'Copied image'
      : feedback === 'copy-unavailable'
        ? 'Copy unavailable'
        : 'Copy image';
  const statusMessage =
    feedback === 'copied'
      ? 'Image copied to clipboard'
      : feedback === 'copy-unavailable'
        ? 'Copy unavailable'
        : feedback === 'export-unavailable'
          ? 'Export unavailable'
          : '';

  const handleCopyImage = async (): Promise<void> => {
    if (!canExport || busyAction !== null) return;

    setBusyAction('copy');
    try {
      const exported = await createPngExport();
      const copied = await writePngToClipboard(exported.blob);
      showFeedback(copied ? 'copied' : 'copy-unavailable');
    } catch {
      showFeedback('copy-unavailable');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadPng = async (): Promise<void> => {
    if (!canExport || busyAction !== null) return;

    setBusyAction('download');
    try {
      const exported = await createPngExport();
      downloadBlob(exported.blob, exported.filename);
    } catch {
      showFeedback('export-unavailable');
    } finally {
      setBusyAction(null);
    }
  };

  const handleOpenUpscaled = async (): Promise<void> => {
    if (!canExport || busyAction !== null || mode === 'original') return;

    setBusyAction('open');
    try {
      const exported = await createPngExport();
      openBlobInNewTab(exported.blob);
    } catch {
      showFeedback('export-unavailable');
    } finally {
      setBusyAction(null);
    }
  };

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
                  onClick={() => {
                    setUserSelectedMode(true);
                    setMode(option.value);
                  }}
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

          {mode === 'nearest' && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={exactDevicePixels}
                onChange={(event) => setExactDevicePixels(event.target.checked)}
                title="Exact device pixels (1:1 DPR)"
                aria-label="Exact device pixels (1:1 DPR)"
              />
              <span>1:1 DPR</span>
            </label>
          )}

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
              {isCanvasMode(mode) && (
                <canvas
                  ref={canvasRef}
                  className={styles.canvas}
                  style={{
                    ...canvasStyle,
                    display: upscaleResult === 'ready' ? 'block' : 'none',
                  }}
                  aria-hidden="true"
                />
              )}
              {(!isCanvasMode(mode) || upscaleResult !== 'ready') && (
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
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                void handleCopyImage();
              }}
              disabled={actionsDisabled}
              title="Copy image to clipboard"
            >
              {feedback === 'copied' ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
              {copyLabel}
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                void handleDownloadPng();
              }}
              disabled={actionsDisabled}
              title="Download the current image as a PNG"
            >
              <DownloadIcon size={12} />
              Download PNG
            </button>
            {mode !== 'original' && (
              <button
                type="button"
                className={styles.actionBtn}
                onClick={() => {
                  void handleOpenUpscaled();
                }}
                disabled={actionsDisabled}
                title="Open the exported PNG in a new tab"
              >
                <ExternalLinkIcon size={12} />
                Open upscaled
              </button>
            )}
            <button type="button" className={styles.actionBtn} onClick={onClose}>
              Close
            </button>
            <span className="sr-only" role="status" aria-live="polite">
              {statusMessage}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
