export interface ChangelogSection {
  heading: string;
  items: readonly string[];
}

export interface ChangelogEntry {
  /** Monotonic release identifier (e.g. '2026.11.21-3') used to track what the user has seen */
  version: string;
  /** Friendly date label, e.g. 'Nov 21, 2026' */
  date: string;
  /** Short human-readable headline */
  title: string;
  /** One-sentence plain-English summary */
  summary: string;
  sections: readonly ChangelogSection[];
}

export const CHANGELOG_STORAGE_KEY = 'clarity-manifest-explorer:last-seen-changelog';

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '2026.11.22-1',
    date: 'Nov 22, 2026',
    title: 'Image upscaling, faster browsing & Clarity branding',
    summary: 'View sharper images, move around the explorer faster, and see a refreshed Clarity look.',
    sections: [
      {
        heading: 'Image viewing',
        items: [
          'Choose Anime4K or Perk Vector upscaling alongside Smooth, Pixelated, and Original.',
          'Use the streamlined single-row toolbar to copy an image, download a PNG, or open the upscaled version.',
        ],
      },
      {
        heading: 'Speed & reliability',
        items: [
          'Search is faster, and switching tabs or moving through history is instant without skeleton flashes.',
          'Cached reloads now restore all 98 manifest tables immediately.',
        ],
      },
      {
        heading: 'Inspector, filters & branding',
        items: [
          'Collapse Sandbox perks and large Linked definitions sections in Overview, and use the compact Filters header.',
          'See Clarity’s new vector M mark, favicons, Clarity Cut typography, social preview image, and links to Clarity and Ko-Fi.',
        ],
      },
    ],
  },
  {
    version: '2026.11.21-4',
    date: 'Nov 21, 2026',
    title: 'Smarter search, Boolean logic & Pretty Find mode',
    summary: 'Find the right definitions faster with more expressive search and a clearer inspector.',
    sections: [
      {
        heading: 'Search & Filtering',
        items: [
          'Use DIM-style AND, OR, NOT, and parentheses in your searches.',
          'Selecting multiple values in one filter category matches any of them, while different categories work together.',
          'Filter autocomplete now supports keyboard navigation and has no result cap.',
          'Use sitewide fuzzy search and adjust how closely results need to match with the fuzziness slider.',
          'Browse a two-column filter menu with 115 DIM sources and shorter season names.',
          'Manifest tables are cached and indexed automatically in the background.',
        ],
      },
      {
        heading: 'Inspector & Visuals',
        items: [
          'Step through JSON matches in Pretty Find mode, or keep matched dropdown sections open with Filter mode.',
          'See crisp context badges in place of inline comments.',
          'Element icons use Bungie’s official colors.',
          'Read release notes in this in-site changelog.',
        ],
      },
    ],
  },
  {
    version: '2026.11.21-3',
    date: 'Nov 21, 2026',
    title: 'Artifact Perks category, DIM season mappings & Deep Search',
    summary: 'Explore artifact perks and seasonal content with clearer categories and more complete season filters.',
    sections: [
      {
        heading: 'Artifact perks & seasons',
        items: [
          'A dedicated Artifact Perks category shows each perk’s seasonal artifact in search results and the inspector.',
          'Filter across all 28 seasons using DIM’s season mappings.',
        ],
      },
      {
        heading: 'Search & navigation',
        items: [
          'The expanded raw-JSON search is now called Deep Search.',
          'Enhanced perk arrows line up with the edge of their icons.',
          'The filter menu has been cleaned up for easier browsing.',
        ],
      },
    ],
  },
  {
    version: '2026.11.21-2',
    date: 'Nov 21, 2026',
    title: 'Token-based Filters, overflow tabs & watermarks',
    summary: 'Search stays responsive while filters and open tabs are easier to manage.',
    sections: [
      {
        heading: 'Search & filters',
        items: [
          'Search waits briefly while you type, keeping the interface smooth.',
          'Filters now open beside the search bar and write editable tokens into your query.',
        ],
      },
      {
        heading: 'Tabs & visuals',
        items: [
          'Open tabs move into a multi-column overflow menu when space is tight.',
          'Middle-click now closes tabs reliably.',
          'Watermarks layer neatly over icons.',
          'Pretty JSON shows escaped \\n newlines visibly.',
        ],
      },
    ],
  },
  {
    version: '2026.11.21-1',
    date: 'Nov 21, 2026',
    title: 'Tab history banner, state persistence & theme polish',
    summary: 'Move through tab history and return to the same explorer state more reliably.',
    sections: [
      {
        heading: 'Tab history & names',
        items: [
          'Each tab has a History / Current / Future banner with scroll and JSON state restoration.',
          'Display names now use multiple categories to distinguish matching hashes.',
        ],
      },
      {
        heading: 'Appearance & shortcuts',
        items: [
          'Transparency checkerboards adapt to the current theme.',
          'The / keyboard shortcut now reliably jumps to search.',
        ],
      },
    ],
  },
];

export function getLatestChangelogVersion(
  entries: readonly ChangelogEntry[] = CHANGELOG,
): string | null {
  return entries[0]?.version ?? null;
}

export interface ChangelogOpenState {
  shouldAutoOpen: boolean;
  expandedVersions: string[];
  unseenVersions: string[];
}

export function computeChangelogOpenState(
  lastSeenVersion: string | null,
  entries: readonly ChangelogEntry[] = CHANGELOG,
): ChangelogOpenState {
  const latestVersion = getLatestChangelogVersion(entries);
  if (latestVersion === null) {
    return { shouldAutoOpen: false, expandedVersions: [], unseenVersions: [] };
  }

  const normalizedLastSeen = lastSeenVersion?.trim() || null;
  if (normalizedLastSeen === null) {
    return {
      shouldAutoOpen: true,
      expandedVersions: [latestVersion],
      unseenVersions: [latestVersion],
    };
  }

  if (normalizedLastSeen === latestVersion) {
    return {
      shouldAutoOpen: false,
      expandedVersions: [latestVersion],
      unseenVersions: [],
    };
  }

  const lastSeenIndex = entries.findIndex((entry) => entry.version === normalizedLastSeen);
  if (lastSeenIndex < 0) {
    return {
      shouldAutoOpen: true,
      expandedVersions: [latestVersion],
      unseenVersions: [latestVersion],
    };
  }

  const unseenVersions = entries.slice(0, lastSeenIndex).map((entry) => entry.version);
  return {
    shouldAutoOpen: unseenVersions.length > 0,
    expandedVersions: unseenVersions.length > 0 ? unseenVersions : [latestVersion],
    unseenVersions,
  };
}

export function readLastSeenChangelogVersion(): string | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    const version = window.localStorage.getItem(CHANGELOG_STORAGE_KEY);
    return version?.trim() || null;
  } catch {
    return null;
  }
}

export function writeLastSeenChangelogVersion(version: string): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHANGELOG_STORAGE_KEY, version);
    }
  } catch {
    // Storage can be unavailable in private browsing or under restrictive policies.
  }
}
