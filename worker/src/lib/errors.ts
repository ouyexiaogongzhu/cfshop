import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** JSON error body `{ error: code }` with the given HTTP status. */
export function jsonError(c: Context, status: ContentfulStatusCode, code: string) {
  return c.json({ error: code }, status);
}
