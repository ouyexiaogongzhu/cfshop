/**
 * Base URL for the commerce API.
 * - Local `next dev`: http://localhost:8787 (override with STORE_API_URL)
 * - OpenNext Worker: prefer service binding `API` when present (see storeFetch)
 *
 * Cart uses httpOnly `cfshop_cart` on the API origin. Local dual-origin
 * (next:3000 + worker:8787) goes through `app/api/cart/**` Route Handlers so
 * the browser stays same-site. Production keeps this BFF proxy + service binding.
 */
export function storeApiBase(): string {
  if (typeof process !== "undefined" && process.env.STORE_API_URL) {
    return process.env.STORE_API_URL.replace(/\/$/, "");
  }
  return "http://localhost:8787";
}

type ServiceFetcher = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

function mergeHeaders(...parts: Array<HeadersInit | undefined>): Headers {
  const out = new Headers();
  for (const part of parts) {
    if (!part) continue;
    const headers = new Headers(part);
    headers.forEach((value, key) => {
      out.set(key, value);
    });
  }
  return out;
}

/**
 * Fetch the commerce API. Uses the `API` Workers service binding when available
 * (OpenNext on Cloudflare); otherwise HTTP to STORE_API_URL / localhost:8787.
 */
export async function storeFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const headers = mergeHeaders({ Accept: "application/json" }, init?.headers);
  const nextInit: RequestInit = { ...init, headers };

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    const api = (env as { API?: ServiceFetcher }).API;
    if (api) {
      return api.fetch(`https://cfshop-api${normalized}`, nextInit);
    }
  } catch {
    // Local next / SSG — no Cloudflare context; fall through to HTTP.
  }

  const url = path.startsWith("http") ? path : `${storeApiBase()}${normalized}`;
  return fetch(url, nextInit);
}
