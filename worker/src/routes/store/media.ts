import { Hono } from "hono";
import { jsonError, safeDecode } from "../../lib/errors";

/** Public product media from R2. Mounted at /api/store. */
export const mediaRoutes = new Hono<{ Bindings: Env }>();

/** Raster images only — SVG/HTML under storefront origin is XSS. */
const KEY_RE = /^products\/[a-zA-Z0-9._/-]+\.(png|jpe?g|webp)$/i;

const EXT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Serve object key under /api/store/media/<key> (key may contain slashes). */
mediaRoutes.get("/media/:key{.+}", async (c) => {
  const key = safeDecode(c.req.param("key") ?? "");
  if (!key || key.includes("..") || !KEY_RE.test(key)) {
    return jsonError(c, 400, "invalid_key");
  }

  const object = await c.env.MEDIA.get(key);
  if (!object) return jsonError(c, 404, "not_found");

  const headers = new Headers();
  const forcedType = contentTypeForKey(key);
  headers.set("content-type", forcedType);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=604800");
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-disposition", `inline; filename="${filenameFromKey(key)}"`);

  return new Response(object.body, { headers });
});

function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TYPE[ext] ?? "application/octet-stream";
}

function filenameFromKey(key: string): string {
  const base = key.split("/").pop() ?? "image";
  return base.replace(/[^\w.-]+/g, "_");
}
