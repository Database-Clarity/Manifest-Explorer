import { LATEST_CHANGELOG_VERSION } from './changelogMeta';

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

export {
  CHANGELOG_STORAGE_KEY,
  LATEST_CHANGELOG_VERSION,
  hasUnseenChangelogMeta,
  readLastSeenChangelogVersion,
  shouldAutoOpenChangelog,
  writeLastSeenChangelogVersion,
} from './changelogMeta';

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: '2026.11.26-1',
    date: 'Nov 26, 2026',
    title: 'Destiny 2 patch notes, split-pane History, date sorting & PlugSet overviews',
    summary: 'Manifest updates are now paired with official Destiny 2 patch notes, History mirrors the Explorer split-pane workspace with a unified Formatted diff view, and Explorer gains date sorting, collapsible table groups, and PlugSet overviews.',
    sections: [
      {
        heading: 'Manifest History & official patch notes',
        items: [
          'Paired archived manifest versions with official Bungie.net Destiny 2 patch notes and major expansion launches (including Ash & Iron and Monument of Triumph) — searchable by patch number, release name, date, or build ID, with direct patch-notes links in both History and the Inspector History tab.',
          'Rebuilt the /history workspace into a resizable split-pane layout with a searchable version picker, compact single-row filter counts, Show 250 more / Show all pagination, saved Diff/Formatted and Inline/Split preferences, and preserved release/workspace state when jumping to Explorer and back.',
          'Redesigned the History Formatted diff view to match the Diff tab: identical toolbar layout, a Changes / Full toggle that keeps diff highlights across the entire definition, inline expanders to reveal unchanged sibling fields in place, uncapped Expand all / Collapse unchanged, and Copy / Download .json buttons.',
          'On phones, History entry diffs open in a smooth slide-over sheet with working browser Back navigation and auto-scrolling tab strips.',
        ],
      },
      {
        heading: 'Explorer, sorting & grouping',
        items: [
          'Added Released and Updated date sorting across the manifest, paired with a clean field selector and direction toggle button.',
          'Added collapsible Group by Table sections in both List and Grid views, removed the 2-column Grid cap for multi-column desktop grids, and kept table names visible on Grid cards.',
          'Replaced native browser dropdowns with custom Clarity-styled menus, embedded the Filters button inside the search bar, collapsed the Tables list by default, and made element: canonical with full filter alias highlighting (damage:, rarity:, weapon:, etc.).',
        ],
      },
      {
        heading: 'Inspector & Overview improvements',
        items: [
          'Renamed Pretty view to Formatted across the app, added inline Bungie icons to JSON reference pills, and aligned Variants hashes with full-row hover highlighting.',
          'Added a structured Overview tab for DestinyPlugSetDefinition with plug search and navigation, clickable PlugSet links on every weapon socket, a working Expand all across randomized perks and shader sockets, and fixed reusable shaders/mods/ornaments incorrectly showing as retired.',
        ],
      },
    ],
  },
  {
    version: '2026.11.24-2',
    date: 'Nov 24, 2026',
    title: 'Faster loading, snappier search & smoother mobile history',
    summary: 'Significantly smaller initial downloads, much faster search and cross-reference lookups, lower memory usage, and smoother scrolling on phones.',
    sections: [
      {
        heading: 'Speed & efficiency',
        items: [
          'Cut the initial page download nearly in half by loading the History page, inspector tabs, dialogs, and image upscaling tools only when you open them.',
          'Search, Load more, Variants, and References are dramatically faster and use about 20% less memory.',
          'Large JSON objects, huge history diffs, massive manifest updates, and widely referenced items now load in smooth chunks instead of freezing the page, and repeat visits reuse cached data.',
        ],
      },
      {
        heading: 'Mobile fixes',
        items: [
          'Fixed touch scrolling across the /history page and inside History Diff, Pretty, and JSON views.',
          'Long JSON lines in diffs and snapshots now wrap cleanly by default so you do not have to scroll sideways to read changes.',
          'Moved the mobile History page link into Settings so the top search bar keeps its full width.',
        ],
      },
    ],
  },
  {
    version: '2026.11.24-1',
    date: 'Nov 24, 2026',
    title: 'Manifest History page, lossless diffs & desktop polish',
    summary: 'Browse entire manifest updates by category, read syntax-highlighted Split/Inline diffs without truncation, and enjoy a cleaner default workspace.',
    sections: [
      {
        heading: 'Manifest history & diffs',
        items: [
          'New /history page lets you browse all 321 manifest updates (2017–2026) categorized by table and change type, opening entries in multi-tab full-page diff views.',
          'All historical diffs are now 100% lossless and rendered with syntax highlighting, switchable Split (side-by-side) and Inline layouts, enclosing JSON key breadcrumbs, and expandable surrounding lines.',
          'Inspect any past manifest version in full with Diff, Pretty (interactive tree), and JSON views, and newest-first Compare selectors.',
        ],
      },
      {
        heading: 'Workspace, navigation & branding',
        items: [
          'Desktop now opens with the collapsed table rail, 2-column card grid, fixed card borders and top spacing, and aligned 33px header bars across both panes.',
          'Middle-click now reliably opens definition cards, rows, and resolved reference pills in a new tab without triggering browser auto-scroll.',
          'Pretty-tab Filter and Find now match and highlight resolved hash pills (such as Stat "Reload Speed" or "Impact") and enum annotations.',
          'Added native Fira Code monospace support (with ligatures disabled for JSON), interactive clear buttons on every search input, official Clarity logos, Ko-Fi support buttons, and a proper gear icon for Settings.',
        ],
      },
    ],
  },
  {
    version: '2026.11.23-2',
    date: 'Nov 23, 2026',
    title: 'Item history',
    summary: 'Explore how Destiny 2 items changed across past manifest versions.',
    sections: [
      {
        heading: 'Manifest history',
        items: [
          'Browse updates across 321 manifests from 2017–2026, with field-level diffs and path filtering.',
          'Compare any two past manifest versions side by side in the Compare view. On mobile, open History with the Hist tab.',
        ],
      },
    ],
  },
  {
    version: '2026.11.23-1',
    date: 'Nov 23, 2026',
    title: 'Uncapped result browsing',
    summary: 'Scroll through every matching definition in the manifest without arbitrary result caps.',
    sections: [
      {
        heading: 'Results & scrolling',
        items: [
          'Initial searches stay fast (2,500 results / 400 in Deep Search) and now show a Load more / Load all bar at the bottom of the list.',
          'Load and smoothly scroll through all 277k+ manifest entries without losing your scroll position or hitting browser scroll-height limits.',
        ],
      },
    ],
  },
  {
    version: '2026.11.22-3',
    date: 'Nov 22, 2026',
    title: 'Clearer table results and a more compact mobile layout',
    summary: 'Table filters, search controls, and toggle states are easier to understand and use.',
    sections: [
      {
        heading: 'Tables & unnamed definitions',
        items: [
          'Selecting a table now includes its unnamed definitions, with clear Table #hash labels and a Show unnamed hint when those results are hidden.',
          'LoadoutName, VendorGroup, and MedalTier have clearer extracted names, and Artifact Perks links now survive reloads.',
        ],
      },
      {
        heading: 'Filters & mobile layout',
        items: [
          'Find the searchable Table selector and a plain-English explanation of manifest tables in Filters.',
          'Selected options stay pinned while searching filters, and mobile puts Filters beside Search and Sort beside the List/Card toggle.',
        ],
      },
      {
        heading: 'Toggle contrast',
        items: [
          'Active List/Card, Filter/Find, Settings, and Lightbox toggles have clearer neutral contrast in both themes.',
        ],
      },
    ],
  },
  {
    version: '2026.11.22-2',
    date: 'Nov 22, 2026',
    title: 'A smoother mobile search and navigation experience',
    summary: 'Search, open tabs, results, and inspector tools are easier to use on mobile.',
    sections: [
      {
        heading: 'Search & filters',
        items: [
          'Focused search expands vertically with scrolling for long queries and across the mobile header while typing.',
          'Deep Search now lives in Filters, with shorter mobile placeholders and searchable Tables options.',
        ],
      },
      {
        heading: 'Mobile tabs & navigation',
        items: [
          'Returning to Results or using browser Back takes you to search while preserving open tabs; use Tabs (N) to return to the inspector.',
          'Inspector links have touch-friendly Open in new tab actions, with a tidier tab strip and no redundant fullscreen button.',
        ],
      },
      {
        heading: 'Cleaner results & reachable tools',
        items: [
          'Search results no longer have a permanent Collector column; the Collector section keeps a Collect current item action.',
          'Settings now always provides What’s new, Search help & shortcuts, Collector, Clarity, and Ko-Fi.',
          'Pretty JSON touch actions, Lightbox focus handling, and safe-area support are improved.',
        ],
      },
    ],
  },
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

if (CHANGELOG[0]?.version !== LATEST_CHANGELOG_VERSION) {
  throw new Error(
    `LATEST_CHANGELOG_VERSION (${LATEST_CHANGELOG_VERSION}) must match CHANGELOG[0].version.`,
  );
}

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
