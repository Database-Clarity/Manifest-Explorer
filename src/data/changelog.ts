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
    version: '2026.11.27-2',
    date: 'Nov 27, 2026',
    title: 'More workspace, less chrome',
    summary: 'Reclaimed vertical and horizontal screen space across the Inspector, Results Grid, Diff, Popovers, and /history — keeping toolbars on single rows and showing more entries and code at once.',
    sections: [
      {
        heading: 'Inspector, Diff & Lightbox density',
        items: [
          'Removed the empty Inspector navigation bar when a tab has no back/forward trail (moving Maximize, Close, and mobile Results into the tab strip), folded "Also in" co-table links inline beside the hash, and moved desktop Raw Copy/Download actions into the tab bar.',
          'Compacted the mobile Diff Base/Swap/Target header onto one row, switched Diff and Formatted JSON toolbar actions to crisp icon buttons at narrow widths so toolbars stay single-row, and tightened the mobile Image Lightbox controls into two clean rows.',
          'Tightened the mobile Inspector History header and cards (starting cards collapsed on phones so you can scan revisions first), and moved References scan duration into a tooltip.',
        ],
      },
      {
        heading: 'Results Grid, Popovers & /history',
        items: [
          'Expanded the Results Grid to fit two compact columns at the default pane width (~2.4× more visible entries at once) while keeping full hashes intact.',
          'Kept /history change-type filters on a single row by hiding empty Unclassified/Reclassified pills, removed duplicated desktop Bungie version lines already shown in the sidebar, and trimmed empty or inactive controls from Collector, Search History, Filters, Settings, and the mobile What’s New header.',
        ],
      },
    ],
  },
  {
    version: '2026.11.27-1',
    date: 'Nov 27, 2026',
    title: 'Site-wide toolbar, scaling & mobile polish',
    summary: 'Standardized control heights, borders, and active states across every tab, subtab, popover, and /history view, fixed mobile inspector and lightbox stacking, and restored Overview hero screenshots.',
    sections: [
      {
        heading: 'Unified toolbars, controls & UI scaling',
        items: [
          'Standardized every segmented toggle (Explorer/History, Filter/Find, Updates/Compare, Diff/Formatted, Inline/Split, Results List/Grid, Settings, Search History, and Lightbox) to match neighboring inputs and buttons at every Interface Scale (85%–150%) and touch size, with active pills staying highlighted on hover.',
          'Aligned the Tables rail, Results pane, and Inspector top bars into one continuous header row, centered the search bar cleanly beside Explorer/History, and matched border contrast across buttons, toggles, and inputs.',
          'Added a Swap button to the Inspector History Compare view, fixed unwrapped Diff rows collapsing narrower than the viewport, tightened Inspector tab close highlights so they never cover the active tab indicator, and switched Light mode diff toolbars to a neutral slate tint.',
        ],
      },
      {
        heading: 'Mobile, Overview & /history fixes',
        items: [
          'Fixed mobile Inspector sheets (both Explorer and /history) and the Image Lightbox appearing underneath the top navigation bar, and restored Overview hero screenshots that were clipping down to a 2px line.',
          'Fixed mobile wrapping and button overflow in the Filters, Collector, and Lightbox toolbars, enlarged touch targets on /history and recent-search delete buttons, prevented /history tab overflow scrollbars from squashing tabs, and added short table badges to disambiguate duplicate /history tabs.',
        ],
      },
    ],
  },
  {
    version: '2026.11.26-5',
    date: 'Nov 26, 2026',
    title: 'Search history, saved & named searches, independent 3-pane resizing & Diff polish',
    summary: 'Added DIM-style search history with pinned and named searches, fixed multiline search clipping, made Tables and Results widths independent with smooth zero-deadzone resizing, and polished Diff layout and scrolling.',
    sections: [
      {
        heading: 'Search history, saved searches & search bar polish',
        items: [
          'Added search history directly to the search bar: focusing shows a compact single-line dropdown of your saved and recent searches, with a "Search history…" popover for browsing the full scrollable list (wrapping long queries up to 3 lines), sorting by Recent, Most used, or A–Z, starring/pinning, naming searches, and clearing recent history while keeping saved searches.',
          'Fixed long multiline search queries clipping above the header or shifting the workspace downward, and turned off spellcheck and Grammarly underlines in search inputs.',
          'Added keyboard undo (Ctrl+Z / Cmd+Z) after clicking any search bar clear button, and debounced search URL updates until typing settles.',
          'Moved the search timing indicator beside the search bar on wide screens (hiding it cleanly on narrower viewports) so the Results header stays uncluttered.',
        ],
      },
      {
        heading: 'Independent 3-pane resizing & Diff polish',
        items: [
          'Gave the Tables rail and Results pane independent widths that both resize against the Inspector pane instead of stealing space from each other, lowered the minimum Results width to 280px for a tighter single-column layout, and fixed the resize drag deadzone.',
          'Kept the Results header Diff shortcut from getting hidden behind the sort dropdown when the Tables rail is open.',
          'Extended the Diff tab viewer all the way to the bottom of the pane, added item icons beside names in the Base and Target selectors, and restored smooth scroll chaining when scrolling past the top or bottom of inline Diff cards and popovers.',
        ],
      },
    ],
  },
  {
    version: '2026.11.26-4',
    date: 'Nov 26, 2026',
    title: 'Diff bucket, top-level Diff tab, smarter inline diffs & unnamed hash pills',
    summary: 'Replaced single-item diff pinning with a multi-item Diff bucket and pinned top-level Diff tab supporting Formatted view, cleaner JSON-aware diffs with readable inline highlights, and clickable pills for unnamed entries.',
    sections: [
      {
        heading: 'Diff bucket & pinned top-level Diff tab',
        items: [
          'Replaced "Pin as diff base" with a persistent Diff bucket: the first item added defaults as Base, the second as Target, and you can switch freely between any items in the bucket using searchable dropdowns.',
          'Moved Diff out of the per-entry subtabs into a top-level tab pinned to the left when open, preserving scroll and expansion state when switching back and forth with regular tabs.',
          'Kept all diff-adding controls out of the way until you open the Diff tab (via the quiet tab-bar icon, Brand menu → Tools, Variants, or Collector), then unlocked in-place row toggles, bulk-adding search results (up to 100), and entity-header toggles while diffing.',
          'Added the Formatted diff view inside the Diff tab alongside Split and Inline diffs, matching /history with Changes/Full filtering, inline unchanged expanders, and resolved hash icons/pills.',
        ],
      },
      {
        heading: 'Smarter JSON diffs & unnamed context pills',
        items: [
          'Ignored JSON trailing-comma-only differences in line diffs so adding or removing the last item in an array or object no longer marks the unchanged sibling line as removed and re-added.',
          'Added conservative value-only inline diff highlights that pinpoint small changes without fragmenting sentences into unreadable slivers, plus sequence-aware array matching in Formatted diffs.',
          'Resolved unnamed manifest definitions on JSON context pills (displayed cleanly as ShortTable #hash, e.g. PlugSet #731468111) so they can be clicked and opened just like named entries.',
        ],
      },
    ],
  },
  {
    version: '2026.11.26-3',
    date: 'Nov 26, 2026',
    title: 'Diff view scrolling, unified touch toolbars & compact tablet layout',
    summary: 'Fixed scrolling inside Diff views across desktop and mobile, aligned toolbar button sizes on touch screens, and reclaimed vertical space in the inspector on tablets.',
    sections: [
      {
        heading: 'Diff scrolling & layout polish',
        items: [
          'Fixed Diff view scrolling across the /history page, Explorer Diff tab, and Inspector History tab for both vertical scrolling and wrap-off horizontal scrolling on desktop and phones.',
          'Unified button and toggle heights across Diff, Formatted, and History toolbars so Inline/Split, Wrap, Expand all, and Download .json align evenly on both mouse and touch devices.',
          'Removed the redundant Diff/JSON/link row from the Inspector header, kept the JSON Filter/Find toolbar on a single row on tablets, and prevented the Filter/Find toggle from stretching across empty space.',
        ],
      },
    ],
  },
  {
    version: '2026.11.26-2',
    date: 'Nov 26, 2026',
    title: 'Reliable high-DPI image upscaling on phones',
    summary: 'Fixed Anime4K, Perk Vector, and Smooth upscaling failing or looking soft on mobile screens, and added clear status notes when a mode falls back.',
    sections: [
      {
        heading: 'Image lightbox & mobile upscaling',
        items: [
          'Fixed high-DPI phones capping upscaled icons at 4× native size — small Bungie icons now render sharply at full device pixel resolution instead of being stretched by the browser.',
          'Hardened Anime4K for mobile WebGL2 GPUs (supporting half-float render targets, spec-safe RGBA8 readback, and automatic recovery after WebGL context loss) and decoupled Smooth/Anime4K from the Perk Vector bundle.',
          'Fixed stale-tab chunk errors permanently breaking upscaling until reload, unified CORS-safe image loading across thumbnails and the lightbox, and added subtle footer notes whenever a mode falls back (such as Perk Vector on full-color art or large native-resolution screenshots) with a Retry action on load failures.',
        ],
      },
    ],
  },
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
