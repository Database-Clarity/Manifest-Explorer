import { useEffect, useId, useState, type ReactNode, type SVGProps } from 'react';

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

export function SettingsIcon({ size = 16, ...rest }: IconProps): ReactNode {
  return (
    <svg
      {...rest}
      width={rest.width ?? size}
      height={rest.height ?? size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
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

export function ChevronLeftIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="m10 3.5-4.5 4.5 4.5 4.5" />
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

export function ArrowUpIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M8 12.5v-9M3.5 7 8 3l4.5 4" />
    </IconFrame>
  );
}

export function ArrowDownIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M8 3.5v9M3.5 9 8 13l4.5-4" />
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

export function LayersIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="m8 2.5 5.5 3L8 8.5l-5.5-3 5.5-3Z" />
      <path d="m2.5 8 5.5 3 5.5-3M2.5 10.5l5.5 3 5.5-3" />
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
      <rect x="1.75" y="2.25" width="5" height="11.5" rx="0.75" />
      <rect x="9.25" y="2.25" width="5" height="11.5" rx="0.75" />
      <path d="M3 5h2.5M3 7.25h2.5M10.5 8.75H13M10.5 11h2.5" />
    </IconFrame>
  );
}

export function SwapIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M12.5 5H4.5M6.5 3 4.5 5l2 2" />
      <path d="M3.5 11h8M9.5 9l2 2-2 2" />
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

/**
 * Filled heart in the Clarity brand gradient (#24EC54 -> #1CDCFC). The gradient
 * id is generated per instance so multiple hearts never collide, and a thin
 * dark stroke keeps it legible on the light "Europa ice" surfaces without
 * altering the brand colors.
 */
export function HeartFilledIcon({ size = 16, ...rest }: IconProps): ReactNode {
  const light = useLightTheme();
  const gradientId = `clarity-heart-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      {...rest}
      width={rest.width ?? size}
      height={rest.height ?? size}
      viewBox="0 0 16 16"
      fill={`url(#${gradientId})`}
      role={rest['aria-label'] ? 'img' : undefined}
      aria-hidden={rest['aria-label'] ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="2.5" y1="3.5" x2="13.5" y2="13.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#24EC54" />
          <stop offset="1" stopColor="#1CDCFC" />
        </linearGradient>
      </defs>
      <path
        d="M8 14.1 2.05 8.43A3.63 3.63 0 0 1 7.18 3.3L8 4.12l.82-.82a3.63 3.63 0 0 1 5.13 5.13L8 14.1Z"
        stroke={light ? 'rgb(0 0 0 / 0.45)' : undefined}
        strokeWidth={light ? 0.75 : undefined}
      />
    </svg>
  );
}

export function BookmarkIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M4 2.5h8v11L8 10.8 4 13.5z" />
    </IconFrame>
  );
}

export function StarIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M8 2.3l1.72 3.5 3.86.56-2.79 2.72.66 3.84L8 11.1l-3.45 1.82.66-3.84L2.42 6.36l3.86-.56L8 2.3Z" />
    </IconFrame>
  );
}

export function StarFilledIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path
        d="M8 2.3l1.72 3.5 3.86.56-2.79 2.72.66 3.84L8 11.1l-3.45 1.82.66-3.84L2.42 6.36l3.86-.56L8 2.3Z"
        fill="currentColor"
        stroke="none"
      />
    </IconFrame>
  );
}

export function ClockIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 4.5V8l2.4 1.4" />
    </IconFrame>
  );
}

export function PencilIcon(props: IconProps): ReactNode {
  return (
    <IconFrame {...props}>
      <path d="M11.1 2.5 13.5 4.9 5.9 12.5 3 13l.5-2.9 7.6-7.6Z" />
      <path d="m9.9 3.7 2.4 2.4" />
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

const CLARITY_C_PATH =
  'M617.47,617.47L500,734.941L265.059,500L500,265.059L617.47,382.53L617.5,441.3L558.735,441.265L500,382.53L382.53,500L500,617.47L558.735,558.735L617.5,558.7L617.47,617.47Z';
const CLARITY_C_EDGE_PATH =
  'M625.23,625.23L507.76,742.701C503.474,746.986 496.526,746.986 492.24,742.701L257.299,507.76C253.014,503.474 253.014,496.526 257.299,492.24L492.24,257.299C496.526,253.014 503.474,253.014 507.76,257.299L625.23,374.77C627.287,376.827 628.443,379.616 628.444,382.524L628.474,441.294C628.475,444.207 627.319,447.001 625.259,449.06C623.2,451.12 620.406,452.276 617.493,452.274L558.729,452.239C555.82,452.237 553.032,451.081 550.975,449.025L500,398.049L398.049,500L500,601.951L550.975,550.975C553.032,548.919 555.82,547.763 558.729,547.761L617.493,547.726C620.406,547.724 623.2,548.88 625.259,550.94C627.319,552.999 628.475,555.793 628.474,558.706L628.444,617.476C628.443,620.384 627.287,623.173 625.23,625.23ZM617.47,617.47L617.5,558.7L558.735,558.735L500,617.47L382.53,500L500,382.53L558.735,441.265L617.5,441.3L617.47,382.53L500,265.059L265.059,500L500,734.941L617.47,617.47Z';
const KOFI_PATH =
  'M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298';

/** Official standalone Clarity mark from d2clarity.com. */
export function ClarityLogoMark({ size = 20, ...rest }: IconProps): ReactNode {
  return (
    <svg
      {...rest}
      width={rest.width ?? size}
      height={rest.height ?? size}
      viewBox="0 0 1000 1000"
      fillRule="evenodd"
      clipRule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="matrix(0.661639,-0.661639,0.661639,0.661639,-176.93,494.81)">
        <path
          d="M905.216,191.653L905.216,839.301C905.216,880.009 872.166,913.06 831.457,913.06L183.81,913.06C143.101,913.06 110.051,880.009 110.051,839.301L110.051,191.653C110.051,150.945 143.101,117.894 183.81,117.894L831.457,117.894C872.166,117.894 905.216,150.945 905.216,191.653Z"
          fill="#000"
        />
      </g>
      <g transform="matrix(1.09254,0,0,1.09254,-46.2703,-46.2703)">
        <path
          d="M87.817,480L480,87.817L480,234.84L234.84,480L87.817,480ZM520,87.817L912.183,480L765.16,480L520,234.84L520,87.817ZM912.183,520L520,912.183L520,765.16L765.16,520L912.183,520ZM480,912.183L87.817,520L234.84,520L480,765.16L480,912.183Z"
          fill="#32EB63"
        />
      </g>
      <g transform="matrix(0.973008,0,0,0.973008,13.4958,13.4958)">
        <path
          d="M617.47,617.47L500,734.941L265.059,500L500,265.059L617.47,382.53L617.5,441.3L558.735,441.265L500,382.53L382.53,500L500,617.47L558.735,558.735L617.5,558.7L617.47,617.47Z"
          fill="#2BDBF9"
        />
      </g>
    </svg>
  );
}

export interface ClarityWordmarkProps extends SVGProps<SVGSVGElement> {
  /** Rendered height in pixels; width follows the official logo's aspect ratio. */
  height?: number;
}

/**
 * Official Clarity text logo from d2clarity.com, rendered with the source SVG's
 * exact brand colors on every theme: white letters with their black even-odd
 * outlines, the cyan `#1CDCFC` i-dot and the green `#24EC54` C. Because every
 * element carries a crisp black outline, no theme-based recoloring is needed.
 */
export function ClarityWordmark({ height = 15, ...rest }: ClarityWordmarkProps): ReactNode {
  const width = (height * 3433) / 1156;

  return (
    <svg
      {...rest}
      width={rest.width ?? width}
      height={height}
      viewBox="0 0 3433 1156"
      fillRule="evenodd"
      clipRule="evenodd"
      role={rest['aria-label'] ? 'img' : undefined}
      aria-hidden={rest['aria-label'] ? undefined : true}
      focusable="false"
    >
      <g transform="translate(-203.976 -502.328)" fillRule="evenodd" clipRule="evenodd">
        <g transform="matrix(0.981254,0,0,0.981254,26.7108,38.001)" fillRule="evenodd" clipRule="evenodd">
          <g
            transform="matrix(1.25301,0,0,1.25301,-506.504,-289.464)"
            fill="#FFFFFF"
            fillRule="evenodd"
            clipRule="evenodd"
          >
            <path d="M1368.69,1368.55L1303.03,1302.92L1303.03,854.105L1405.2,854.105L1405.2,1267.01L1490.74,1266.98L1490.74,1368.55L1368.69,1368.55Z" />
            <path d="M1353.87,1383.38L1288.21,1317.75C1284.28,1313.82 1282.06,1308.48 1282.06,1302.92L1282.06,854.105C1282.06,842.525 1291.45,833.138 1303.03,833.138L1405.2,833.138C1416.78,833.138 1426.17,842.525 1426.17,854.105L1426.17,1246.04L1490.73,1246.01C1496.3,1246.01 1501.63,1248.22 1505.56,1252.15C1509.5,1256.08 1511.71,1261.42 1511.71,1266.98L1511.71,1368.55C1511.71,1380.13 1502.32,1389.52 1490.74,1389.52L1368.69,1389.52C1363.14,1389.52 1357.81,1387.31 1353.87,1383.38ZM1368.69,1368.55L1490.74,1368.55L1490.74,1266.98L1405.2,1267.01L1405.2,854.105L1303.03,854.105L1303.03,1302.92L1368.69,1368.55Z" fill="#000" />
            <path d="M1611.07,1368.55L1545.45,1302.92L1545.45,1110.69L1863.34,1110.69L1863.34,1056.55L1545.45,1056.58L1545.45,955.005L1899.26,955.005L1965.03,1020.64L1965.03,1368.55L1611.07,1368.55ZM1647.02,1267.01L1863.34,1266.98L1863.34,1200.73L1647.02,1200.73L1647.02,1267.01Z" />
            <path d="M1596.25,1383.37L1530.63,1317.75C1526.7,1313.81 1524.49,1308.48 1524.49,1302.92L1524.49,1110.69C1524.49,1099.11 1533.87,1089.72 1545.45,1089.72L1842.38,1089.72L1842.38,1077.52L1545.45,1077.54C1539.89,1077.54 1534.56,1075.33 1530.63,1071.4C1526.7,1067.47 1524.49,1062.14 1524.49,1056.58L1524.49,955.005C1524.49,943.425 1533.87,934.038 1545.45,934.038L1899.26,934.038C1904.81,934.038 1910.14,936.241 1914.07,940.164L1979.84,1005.8C1983.78,1009.73 1985.99,1015.07 1985.99,1020.64L1985.99,1368.55C1985.99,1380.13 1976.61,1389.52 1965.03,1389.52L1611.07,1389.52C1605.51,1389.52 1600.18,1387.31 1596.25,1383.37ZM1611.07,1368.55L1965.03,1368.55L1965.03,1020.64L1899.26,955.005L1545.45,955.005L1545.45,1056.58L1863.34,1056.55L1863.34,1110.69L1545.45,1110.69L1545.45,1302.92L1611.07,1368.55ZM1647.02,1267.01L1647.02,1200.73L1863.34,1200.73L1863.34,1266.98L1647.02,1267.01ZM1667.99,1246.04L1842.38,1246.02L1842.38,1221.69L1667.99,1221.69L1667.99,1246.04Z" fill="#000" />
            <path d="M2023.17,1368.55L2023.17,1020.64L2089.44,955.005L2353.41,955.005L2353.41,1056.58L2124.74,1056.55L2124.74,1368.55L2023.17,1368.55Z" />
            <path d="M2002.2,1368.55L2002.2,1020.64C2002.2,1015.05 2004.44,1009.68 2008.42,1005.74L2074.69,940.108C2078.61,936.219 2083.92,934.038 2089.44,934.038L2353.41,934.038C2364.99,934.038 2374.38,943.425 2374.38,955.005L2374.38,1056.58C2374.38,1062.14 2372.17,1067.47 2368.24,1071.4C2364.31,1075.33 2358.97,1077.54 2353.41,1077.54L2145.71,1077.52L2145.71,1368.55C2145.71,1380.13 2136.32,1389.52 2124.74,1389.52L2023.17,1389.52C2011.59,1389.52 2002.2,1380.13 2002.2,1368.55ZM2023.17,1368.55L2124.74,1368.55L2124.74,1056.55L2353.41,1056.58L2353.41,955.005L2089.44,955.005L2023.17,1020.64L2023.17,1368.55Z" fill="#000" />
            <rect x="2408.91" y="955.005" width="101.57" height="413.545" />
            <path d="M2387.94,1368.55L2387.94,955.005C2387.94,943.425 2397.33,934.038 2408.91,934.038L2510.48,934.038C2522.06,934.038 2531.44,943.425 2531.44,955.005L2531.44,1368.55C2531.44,1380.13 2522.06,1389.52 2510.48,1389.52L2408.91,1389.52C2397.33,1389.52 2387.94,1380.13 2387.94,1368.55ZM2408.91,1368.55L2510.48,1368.55L2510.48,955.005L2408.91,955.005L2408.91,1368.55Z" fill="#000" />
            <g transform="translate(0 -16.5143)" fillRule="evenodd" clipRule="evenodd">
              <rect x="2408.91" y="819.533" width="101.57" height="102.172" fill="#1CDCFC" />
              <path d="M2387.94,921.705L2387.94,819.533C2387.94,807.953 2397.33,798.566 2408.91,798.566L2510.48,798.566C2522.06,798.566 2531.44,807.953 2531.44,819.533L2531.44,921.705C2531.44,933.284 2522.06,942.671 2510.48,942.671L2408.91,942.671C2397.33,942.671 2387.94,933.284 2387.94,921.705ZM2408.91,921.705L2510.48,921.705L2510.48,819.533L2408.91,819.533L2408.91,921.705Z" fill="#000" />
            </g>
            <path d="M2649.14,1368.55L2582.88,1302.92L2582.88,854.105L2684.45,854.105L2684.45,955.038L2841.56,955.038L2841.56,1056.61L2684.45,1056.61L2684.45,1267.01L2841.56,1266.98L2841.56,1368.55L2649.14,1368.55Z" />
            <path d="M2634.38,1383.44L2568.13,1317.82C2564.15,1313.88 2561.91,1308.52 2561.91,1302.92L2561.91,854.105C2561.91,842.525 2571.3,833.138 2582.88,833.138L2684.45,833.138C2696.03,833.138 2705.42,842.525 2705.42,854.105L2705.42,934.072L2841.56,934.072C2853.14,934.072 2862.53,943.459 2862.53,955.038L2862.53,1056.61C2862.53,1068.19 2853.14,1077.58 2841.56,1077.58L2705.42,1077.58L2705.42,1246.04L2841.55,1246.01C2847.12,1246.01 2852.45,1248.22 2856.38,1252.15C2860.32,1256.08 2862.53,1261.42 2862.53,1266.98L2862.53,1368.55C2862.53,1380.13 2853.14,1389.52 2841.56,1389.52L2649.14,1389.52C2643.61,1389.52 2638.31,1387.33 2634.38,1383.44ZM2649.14,1368.55L2841.56,1368.55L2841.56,1266.98L2684.45,1267.01L2684.45,1056.61L2841.56,1056.61L2841.56,955.038L2684.45,955.038L2684.45,854.105L2582.88,854.105L2582.88,1302.92L2649.14,1368.55Z" fill="#000" />
            <path d="M1103.57,1527.32L1205.89,1425.04L3217.25,1425.03L3217.25,1368.55L2965.02,1368.55L2898.74,1298.85L2898.74,956.431L3000.32,956.431L3000.32,1267.01L3217.25,1267.01L3217.25,956.431L3318.82,956.431L3318.82,1461.58L3253.2,1527.32L1103.57,1527.32Z" />
            <path d="M1088.75,1512.5L1191.06,1410.21C1195,1406.28 1200.33,1404.08 1205.89,1404.07L3196.28,1404.06L3196.28,1389.52L2965.02,1389.52C2959.27,1389.52 2953.78,1387.16 2949.82,1383L2883.55,1313.3C2879.84,1309.4 2877.78,1304.23 2877.78,1298.85L2877.78,956.431C2877.78,944.851 2887.16,935.464 2898.74,935.464L3000.32,935.464C3011.89,935.464 3021.28,944.851 3021.28,956.431L3021.28,1246.04L3196.28,1246.04L3196.28,956.431C3196.28,944.851 3205.67,935.464 3217.25,935.464L3318.82,935.464C3330.4,935.464 3339.78,944.851 3339.78,956.431L3339.78,1461.58C3339.78,1467.13 3337.58,1472.46 3333.66,1476.39L3268.04,1542.13C3264.11,1546.08 3258.77,1548.29 3253.2,1548.29L1103.57,1548.29C1095.09,1548.29 1087.45,1543.18 1084.2,1535.35C1080.96,1527.51 1082.75,1518.49 1088.75,1512.5ZM1103.57,1527.32L3253.2,1527.32L3318.82,1461.58L3318.82,956.431L3217.25,956.431L3217.25,1267.01L3000.32,1267.01L3000.32,956.431L2898.74,956.431L2898.74,1298.85L2965.02,1368.55L3217.25,1368.55L3217.25,1425.03L1205.89,1425.04L1103.57,1527.32Z" fill="#000" />
          </g>
          <g transform="matrix(2.39395,0,0,2.39395,-427.616,-135.069)" fillRule="evenodd" clipRule="evenodd">
            <path d={CLARITY_C_PATH} fill="#24EC54" />
            <path d={CLARITY_C_EDGE_PATH} fill="#000" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** Official Ko-fi cup-and-heart glyph. */
export function KofiIcon({ size = 16, ...rest }: IconProps): ReactNode {
  return (
    <svg
      {...rest}
      width={rest.width ?? size}
      height={rest.height ?? size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={KOFI_PATH} />
    </svg>
  );
}

/** Kept as an alias for existing consumers. */
export const ClarityMark = ManifestMark;
