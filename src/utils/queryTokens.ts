/**
 * Pure helpers for editing structured filter tokens (like `is:enhanced` or
 * `cat:"Hand Cannon"`) inside the search-bar query string. The Filters popover
 * uses them so every chip visibly writes its exact syntax into the search bar,
 * where the user can edit, combine, and share it.
 */

/**
 * Keys the manifest query parser recognizes as structured filters. Used to
 * count and clear filter tokens while preserving plain search words.
 */
const FILTER_TOKEN_RE =
  /^-?(table|t|tier|rarity|damage|element|el|dmg|class|type|subtype|weapon|ammo|slot|season|s|source|trait|cat|category|categories|is|has):.+/i;

/**
 * Splits a query into whitespace-separated tokens while keeping quoted
 * segments (including their quotes) together, so `cat:"Hand Cannon"` stays a
 * single token exactly like the manifest query parser treats it.
 */
function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of query) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0) tokens.push(current);

  return tokens;
}

/**
 * Normalizes a token for comparison: lowercase, with quoted values unwrapped
 * so `cat:"Hand Cannon"` and `cat:Hand Cannon` compare equal. A leading `-`
 * (negation) is kept, so `-is:enhanced` never counts as `is:enhanced`.
 */
function normalizeQueryToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) return '';

  const colon = trimmed.indexOf(':');
  if (colon <= 0) return trimmed.toLowerCase();

  const key = trimmed.slice(0, colon).toLowerCase();
  const rawValue = trimmed.slice(colon + 1).trim();
  const value =
    rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')
      ? rawValue.slice(1, -1)
      : rawValue;
  return `${key}:${value.toLowerCase()}`;
}

/**
 * True when the query already contains the exact token, matched case-
 * insensitively and quote-insensitively (so hand-typed variants count).
 */
export function hasQueryToken(query: string, token: string): boolean {
  const needle = normalizeQueryToken(token);
  if (needle.length === 0) return false;
  return tokenizeQuery(query).some((entry) => normalizeQueryToken(entry) === needle);
}

/**
 * Adds the token to the query when absent (cleanly separated by a single
 * space), or removes it and normalizes whitespace when already present.
 */
export function toggleQueryToken(query: string, token: string): string {
  const needle = normalizeQueryToken(token);
  const cleanToken = token.trim();
  if (needle.length === 0 || cleanToken.length === 0) return query.trim();

  const tokens = tokenizeQuery(query);
  const present = tokens.some((entry) => normalizeQueryToken(entry) === needle);
  if (!present) {
    const base = query.trim();
    return base.length === 0 ? cleanToken : `${base} ${cleanToken}`;
  }

  return tokens.filter((entry) => normalizeQueryToken(entry) !== needle).join(' ');
}

/** Number of structured filter tokens (like `tier:exotic` or `-is:redacted`) in the query. */
export function countQueryFilterTokens(query: string): number {
  return tokenizeQuery(query).filter((token) => FILTER_TOKEN_RE.test(token)).length;
}

/**
 * Removes every structured filter token while keeping plain text search
 * words (and the `deep:` prefix) exactly as the user typed them.
 */
export function clearQueryFilterTokens(query: string): string {
  return tokenizeQuery(query)
    .filter((token) => !FILTER_TOKEN_RE.test(token))
    .join(' ');
}
