/** Lowercase and strip all whitespace/punctuation for source lookups. */
export function normalizeSourceLookup(token: string): string {
  return token.toLowerCase().replace(/[^a-z0-9]/g, '');
}
