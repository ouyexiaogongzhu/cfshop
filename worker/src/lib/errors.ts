import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** JSON error body `{ error: code }` with the given HTTP status. */
export function jsonError(c: Context, status: ContentfulStatusCode, code: string) {
  return c.json({ error: code }, status);
}

/**
 * decodeURIComponent that returns null on a malformed escape instead of throwing.
 * Throwing here would escape the handler and surface as a 500 from the global error handler.
 */
export function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
