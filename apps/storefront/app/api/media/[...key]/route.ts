import { storeFetch } from "@/lib/api";

type Params = { params: Promise<{ key: string[] }> };

/** Browser → storefront → API service binding → R2 (no public API hop). */
export async function GET(_request: Request, { params }: Params) {
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
  if (!key || key.includes("..")) {
    return new Response("Bad Request", { status: 400 });
  }

  const upstream = await storeFetch(`/api/store/media/${key}`, {
    headers: { Accept: "*/*" },
    cache: "force-cache",
  });

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("ETag", etag);

  return new Response(upstream.body, { status: upstream.status, headers });
}
