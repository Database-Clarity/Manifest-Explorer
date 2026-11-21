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

/**
 * The Clarity diamond Ghost-shell, using the exact paths from the app favicon.
 * The brand colours are fixed; a dark rotated plate from the light favicon
 * keeps the mark legible on the light "Europa ice" theme.
 */
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

export function ClarityMark({ size = 20, ...rest }: IconProps): ReactNode {
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
        <g transform="matrix(0.661639,-0.661639,0.661639,0.661639,-176.93,494.81)">
          <path
            d="M905.216,191.653L905.216,839.301C905.216,880.009 872.166,913.06 831.457,913.06L183.81,913.06C143.101,913.06 110.051,880.009 110.051,839.301L110.051,191.653C110.051,150.945 143.101,117.894 183.81,117.894L831.457,117.894C872.166,117.894 905.216,150.945 905.216,191.653Z"
            fill="#000"
          />
        </g>
      ) : null}
      <g transform="matrix(1.09254,0,0,1.09254,-46.2703,-46.2703)">
        <path
          d="M87.817,480L480,87.817L480,234.84L234.84,480L87.817,480ZM520,87.817L912.183,480L765.16,480L520,234.84L520,87.817ZM912.183,520L520,912.183L520,765.16L765.16,520L912.183,520ZM480,912.183L87.817,520L234.84,520L480,765.16L480,912.183Z"
          fill="#24EC54"
        />
      </g>
      <g transform="matrix(0.959048,0,0,0.959048,20.4758,20.4758)">
        <path
          d="M617.47,617.47L500,734.941L265.059,500L500,265.059L617.47,382.53L617.5,441.3L558.735,441.265L500,382.53L382.53,500L500,617.47L558.735,558.735L617.5,558.7L617.47,617.47Z"
          fill="#1CDCFC"
        />
      </g>
    </svg>
  );
}
