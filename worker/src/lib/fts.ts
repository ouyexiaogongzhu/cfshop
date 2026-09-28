const FTS5_SPECIAL_CHARS = /["\-*(){}[\]^~:\\/<>|@#&+!?.,'=\u0964\u0965]/g;
const MAX_SEARCH_TOKENS = 8;

/**
 * Splits buyer/admin input into bounded search tokens. Input is NFC-normalized
 * first so composed/decomposed Unicode produces one token form.
 */
export function sanitizeSearchTokens(input: string): string[] {
  const cleaned = input.normalize("NFC").replace(FTS5_SPECIAL_CHARS, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS);
}

/**
 * Sanitize user input for use in an FTS5 MATCH expression.
 * Strips special characters, splits into words, appends * for prefix matching,
 * and joins with spaces (implicit AND — all words must match).
 * Returns empty string if input is empty or contains no valid tokens.
 */
export function sanitizeFtsQuery(input: string): string {
  const tokens = sanitizeSearchTokens(input).map((token) => `${token}*`);
  return tokens.length > 0 ? tokens.join(" ") : "";
}
