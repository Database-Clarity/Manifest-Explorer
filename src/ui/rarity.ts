/**
 * Maps a Destiny tier enum to the matching rarity text token.
 * Rarity is expressed on text (category lines, type labels), never as an edge
 * drawn over the artwork tile.
 */
export function getTierColorVar(tierType?: number): string | undefined {
  switch (tierType) {
    case 6:
      return 'var(--tier-exotic)';
    case 5:
      return 'var(--tier-legendary)';
    case 4:
      return 'var(--tier-rare)';
    case 3:
      return 'var(--tier-uncommon)';
    case 2:
      return 'var(--tier-common)';
    default:
      return undefined;
  }
}
