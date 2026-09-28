import { storeFetch } from "@/lib/api";

type Params = { params: Promise<{ key: string[] }> };

const KEY_RE = /^products\/[a-zA-Z0-9._/-]+\.(png|jpe?g|webp)$/i;

/** Browser → storefront → API service binding → R2 (no public API hop). */
export async function GET(_request: Request, { params }: Params) {
  try {
    const resolved = await params;
    const parts = resolved.key ?? [];
    const key = parts.map(decodeURIComponent).join("/");
    if (!key || key.includes("..") || !KEY_RE.test(key)) {
      return new Response("Bad Request", { status: 400 });
    }

    const upstream = await storeFetch(`/api/store/media/${key}`, {
      headers: { Accept: "*/*" },
    });

    // Buffer through the binding — streaming bodies can fail on OpenNext Workers.
    const bytes = await upstream.arrayBuffer();
    const headers = new Headers();
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const cacheControl = upstream.headers.get("cache-control");
    headers.set(
      "Cache-Control",
      cacheControl ?? "public, max-age=86400, stale-while-revalidate=604800",
    );
    const etag = upstream.headers.get("etag");
    if (etag) headers.set("ETag", etag);
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(bytes, { status: upstream.status, headers });
  } catch (err) {
    console.error("media_proxy_failed", String(err));
    return Response.json({ error: "media_proxy_failed" }, { status: 500 });
  }
}
