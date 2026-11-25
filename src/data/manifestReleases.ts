const MANIFEST_RELEASES: Readonly<Record<string, string>> = {
  '2017-09-09': 'Destiny 2 Launch',
  '2017-12-05': 'Curse of Osiris',
  '2018-05-08': 'Warmind',
  '2018-09-04': 'Forsaken',
  '2018-12-04': 'Black Armory',
  '2019-03-05': "Joker's Wild",
  '2019-06-04': 'Season of Opulence',
  '2019-10-01': 'Shadowkeep',
  '2019-12-10': 'Season of Dawn',
  '2020-03-10': 'Season of the Worthy',
  '2020-06-09': 'Season of Arrivals',
  '2020-11-10': 'Beyond Light',
  '2021-02-09': 'Season of the Chosen',
  '2021-05-11': 'Season of the Splicer',
  '2021-08-24': 'Season of the Lost',
  '2021-12-07': '30th Anniversary',
  '2022-02-22': 'The Witch Queen',
  '2022-05-24': 'Season of the Haunted',
  '2022-08-23': 'Season of Plunder',
  '2022-12-06': 'Season of the Seraph',
  '2023-02-28': 'Lightfall',
  '2023-05-23': 'Season of the Deep',
  '2023-08-22': 'Season of the Witch',
  '2023-11-28': 'Season of the Wish',
  '2024-04-09': 'Into the Light',
  '2024-06-04': 'The Final Shape',
  '2024-06-11': 'Episode: Echoes',
  '2024-10-08': 'Episode: Revenant',
  '2025-02-04': 'Episode: Heresy',
  '2025-07-15': 'The Edge of Fate',
  '2025-09-09': 'Ash & Iron',
  '2025-12-02': 'Renegades',
  '2026-06-09': 'Monument of Triumph',
};

/**
 * Resolve the archive's UTC release date to the Destiny 2 expansion, episode,
 * season, or major update launched on that date.
 */
export function resolveManifestReleaseName(date: string): string | null {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return null;
  return MANIFEST_RELEASES[new Date(timestamp).toISOString().slice(0, 10)] ?? null;
}

/** Search terms that make release names discoverable in the version picker. */
export function manifestReleaseSearchTerms(date: string): string {
  const releaseName = resolveManifestReleaseName(date);
  if (!releaseName) return '';
  return `${releaseName} ${releaseName.replace(/^The\s+/i, '')}`;
}
