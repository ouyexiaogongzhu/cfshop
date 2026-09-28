import { storeApiBase } from "@/lib/api";

/**
 * Proxies cart requests to the Worker store API and forwards Cookie /
 * Set-Cookie so the browser only talks to the storefront origin.
 *
 * Local dual-origin (next:3000 + worker:8787) cannot share httpOnly cookies
 * across sites. Production should keep API same-site OR keep this BFF proxy.
 */
export async function proxyCartRequest(
  request: Request,
  workerPath: string,
): Promise<Response> {
  const url = `${storeApiBase()}${workerPath.startsWith("/") ? workerPath : `/${workerPath}`}`;

  const headers = new Headers();
  headers.set("Accept", "application/json");

  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("Cookie", cookie);

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const upstream = await fetch(url, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get("content-type");
  if (upstreamContentType) {
    responseHeaders.set("Content-Type", upstreamContentType);
  }

  const setCookies =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : [];
  if (setCookies.length > 0) {
    for (const value of setCookies) {
      responseHeaders.append("Set-Cookie", value);
    }
  } else {
    const single = upstream.headers.get("set-cookie");
    if (single) responseHeaders.append("Set-Cookie", single);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
