<img src="public/favicon-dark.svg" width="48" height="48" alt="Clarity">

# Manifest Explorer

Fast, desktop-grade Destiny 2 Manifest explorer with mobile support, built in the Clarity Control design system.

**Live site:** [manifest.d2clarity.com](https://manifest.d2clarity.com)

## Features

- **Zero-proxy Bungie Manifest engine** — fetches component tables directly from Bungie.net in a Web Worker with IndexedDB caching and mobile-safe streaming for full `DestinyInventoryItemDefinition` (199 MB raw).
- **Instant search & query operators** — ranked full-text search, unsigned/signed/hex/multi-hash lookup, plus `table:`, `tier:`, `damage:`, `class:`, `type:`, `cat:`, `is:`, `has:`, and `-negation` operators.
- **Multi-tab inspector & deep navigation** — `Ctrl+Click` / middle-click to open definitions in separate tabs, breadcrumb traversal stack (`Alt+←`/`Alt+→`), maximize toggle, and shareable hash URLs.
- **Rich inspection views** — annotated Pretty JSON tree (inline Bungie icons/screenshots with natural dimensions, RGB swatches, enum & bitmask labels, clickable resolved hash links), Overview (attributes, stat bars, grouped sockets & PlugSets, perks, lore, optional Clarity community descriptions), Variants, Reverse References, Raw JSON, and structural Diff.
- **Hash Collector** — Collect Mode & scratchpad with JSON, TypeScript `const`, CSV, Markdown, and grouped JSON export.
- **Clarity customisation** — System / Dark / Europa Ice Light theme, 85–150% UI scale, Compact / Large touch targets, independent code font settings, and all 13 Bungie locales.

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
```
