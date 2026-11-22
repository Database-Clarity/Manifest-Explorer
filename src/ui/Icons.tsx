import { useEffect, useState, type ReactNode, type SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  /** Rendered width and height in pixels. */
  size?: number;
}

function IconFrame({ size = 16, children, ...rest }: IconProps): ReactNode {
  return (
    <svg
      {...rest}
      width={rest.width ?? size}
      height={rest.height ?? size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function SearchIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </IconFrame>
  );
}

export function FilterIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h9" />
      <circle cx="6" cy="4.5" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="10" cy="8" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="11.5" r="1.35" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function SettingsIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 2.25v1.5M8 12.25v1.5M2.25 8h1.5M12.25 8h1.5M3.93 3.93l1.06 1.06M11.01 11.01l1.06 1.06M12.07 3.93l-1.06 1.06M4.99 11.01l-1.06 1.06" />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </IconFrame>
  );
}

export function ChevronRightIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="m6 3.5 4.5 4.5L6 12.5" />
    </IconFrame>
  );
}

export function ChevronDownIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="m3.5 6 4.5 4.5L12.5 6" />
    </IconFrame>
  );
}

export function ArrowLeftIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M12.5 8h-9M7 3.5 3 8l4 4.5" />
    </IconFrame>
  );
}

export function ArrowRightIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M3.5 8h9M9 3.5 13 8l-4 4.5" />
    </IconFrame>
  );
}

export function CopyIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </IconFrame>
  );
}

export function CheckIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="m3 8.5 3 3 7-7" />
    </IconFrame>
  );
}

export function PlusIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M8 3v10M3 8h10" />
    </IconFrame>
  );
}

export function ListIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M5.5 4h8M5.5 8h8M5.5 12h8" />
      <circle cx="2.75" cy="4" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="2.75" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function GridIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="0.5" />
    </IconFrame>
  );
}

export function PanelLeftIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <path d="M6.5 3v10" />
    </IconFrame>
  );
}

export function DiffIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M4 2.5v5M1.5 5h5M12 8.5v5M9.5 11h5" />
    </IconFrame>
  );
}

export function RefreshIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M12.8 8A4.8 4.8 0 1 1 11.4 4.4" />
      <path d="M12.8 2.4v2.4h-2.4" />
    </IconFrame>
  );
}

export function ExternalLinkIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M9 3.5h3.5V7" />
      <path d="M12.5 3.5 7.5 8.5" />
      <path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
    </IconFrame>
  );
}

export function HeartIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M8 13.25C6.4 12.1 3.25 9.7 3.25 6.9 3.25 5.3 4.5 4 6.05 4c.8 0 1.5.36 1.95.93A2.44 2.44 0 0 1 9.95 4c1.55 0 2.8 1.3 2.8 2.9 0 2.8-3.15 5.2-4.75 6.35Z" />
    </IconFrame>
  );
}

export function BookmarkIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M4 2.5h8v11L8 10.8 4 13.5z" />
    </IconFrame>
  );
}

export function HelpIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.2 6.2a1.85 1.85 0 1 1 2.7 1.65c-.6.3-.9.75-.9 1.35v.3" />
      <circle cx="8" cy="11.7" r="0.6" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}

export function TrashIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.6 9h6.8l.6-9M6.5 7v4M9.5 7v4" />
    </IconFrame>
  );
}

export function DownloadIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13h10" />
    </IconFrame>
  );
}

export function ImageIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <rect x="2.5" y="3" width="11" height="10" rx="1" />
      <circle cx="5.5" cy="6" r="1.2" />
      <path d="m3 12 3.5-3.5L9 11l2-2 2.5 3" />
    </IconFrame>
  );
}

export function LinkIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.3 4.8 8.6 3.5a2.6 2.6 0 0 1 3.7 3.7l-1.3 1.3" />
      <path d="M8.7 11.2 7.4 12.5a2.6 2.6 0 0 1-3.7-3.7l1.3-1.3" />
    </IconFrame>
  );
}

export function DatabaseIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.89 5-2V4" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.89 5-2" />
    </IconFrame>
  );
}

function prefersLightScheme(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  );
}

function readingLightTheme(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'light') {
    return true;
  }
  if (theme === 'dark') {
    return false;
  }
  return prefersLightScheme();
}

function useLightTheme(): boolean {
  const [light, setLight] = useState(readingLightTheme);

  useEffect(() => {
    const update = (): void => setLight(readingLightTheme());
    const media =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: light)')
        : null;
    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(update)
        : null;

    media?.addEventListener('change', update);
    observer?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    update();

    return () => {
      media?.removeEventListener('change', update);
      observer?.disconnect();
    };
  }, []);

  return light;
}

export function MaximizeIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M9.5 3h3.5v3.5M6.5 13H3V9.5M13 3 9 7M3 13l4-4" />
    </IconFrame>
  );
}

export function MinimizeIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M9.5 6.5H13M9.5 6.5V3M6.5 9.5H3M6.5 9.5V13M13 3 9.5 6.5M3 13l3.5-3.5" />
    </IconFrame>
  );
}

/** The green 45°-chamfered octagon shell split into four crisp quadrants. */
const MANIFEST_OCTAGON_PATH =
  'M48 470V240L240 48H470V154H283.91L154 283.91V470ZM530 48H760L952 240V470H846V283.91L716.09 154H530ZM952 530V760L760 952H530V846H716.09L846 716.09V530ZM470 952H240L48 760V530H154V716.09L283.91 846H470Z';

/** The cyan ClarityCut-900 micro-cut M, mirror-symmetric around x=500. */
const MANIFEST_CLARITY_CUT_PATH =
  'M224.59 704.51V295.49L265.5 254.59H333.67L500 452.96L666.33 254.59H734.5L775.41 295.49V704.51L734.5 745.41H669.39V416.15L500 617.93L330.61 416.15V745.41H265.5Z';

/** The black octagon backing plate used on the light theme. */
const MANIFEST_PLATE_PATH = 'M208 8H792L992 208V792L792 992H208L8 792V208Z';

/**
 * The approved 3B-3c strictly-vector Clarity mark: a green chamfered octagon
 * shell around a cyan micro-cut M. Light mode wraps the same mark in a black
 * octagon plate so it stays legible on the light "Europa ice" theme.
 */
export function ManifestMark({ size = 20, ...rest }: IconProps): ReactNode {
  const light = useLightTheme();

  return (
    <svg
      {...rest}
      width={rest.width ?? size}
      height={rest.height ?? size}
      viewBox="0 0 1000 1000"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {light ? (
        <>
          <path d={MANIFEST_PLATE_PATH} fill="#000" />
          <g transform="translate(500 500) scale(0.86) translate(-500 -500)">
            <path d={MANIFEST_OCTAGON_PATH} fill="#24EC54" />
            <path d={MANIFEST_CLARITY_CUT_PATH} fill="#1CDCFC" />
          </g>
        </>
      ) : (
        <>
          <path d={MANIFEST_OCTAGON_PATH} fill="#24EC54" />
          <path d={MANIFEST_CLARITY_CUT_PATH} fill="#1CDCFC" />
        </>
      )}
    </svg>
  );
}

/** Kept as an alias for existing consumers. */
export const ClarityMark = ManifestMark;
