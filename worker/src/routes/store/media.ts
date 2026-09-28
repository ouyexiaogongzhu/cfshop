import { Hono } from "hono";
import { jsonError } from "../../lib/errors";

/** Public product media from R2. Mounted at /api/store. */
export const mediaRoutes = new Hono<{ Bindings: Env }>();

const KEY_RE = /^products\/[a-zA-Z0-9._/-]+$/;

/** Serve object key under /api/store/media/<key> (key may contain slashes). */
mediaRoutes.get("/media/:key{.+}", async (c) => {
  const key = decodeURIComponent(c.req.param("key") ?? "");
  if (!key || key.includes("..") || !KEY_RE.test(key)) {
    return jsonError(c, 400, "invalid_key");
  }

  const object = await c.env.MEDIA.get(key);
  if (!object) return jsonError(c, 404, "not_found");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  if (!headers.has("content-type")) {
    headers.set("content-type", guessContentType(key));
  }

  return new Response(object.body, { headers });
});

function guessContentType(key: string): string {
  if (key.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  if (key.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}
