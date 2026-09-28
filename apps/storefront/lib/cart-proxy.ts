import { storeFetch } from "@/lib/api";

/**
 * Proxies a browser request to the commerce Worker, forwarding Cookie and
 * Set-Cookie. Uses `storeFetch` so production hits the `API` service binding.
 */
export async function proxyStoreRequest(
  request: Request,
  workerPath: string,
  init?: { search?: string },
): Promise<Response> {
  const path = workerPath.startsWith("/") ? workerPath : `/${workerPath}`;
  const urlPath = init?.search ? `${path}${init.search}` : path;

  const headers = new Headers();
  headers.set("Accept", "application/json");

  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("Cookie", cookie);

  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const upstream = await storeFetch(urlPath, {
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

/** @deprecated use proxyStoreRequest */
export async function proxyCartRequest(
  request: Request,
  workerPath: string,
): Promise<Response> {
  return proxyStoreRequest(request, workerPath);
}
