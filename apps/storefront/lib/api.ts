/**
 * Commerce API access for the storefront Worker.
 *
 * Production (OpenNext on Cloudflare): MUST use the `API` service binding to
 * `cfshop-api`. That call stays on Cloudflare's network — it does not go out
 * to the public Internet or *.workers.dev.
 *
 * Local `next dev` only: HTTP to STORE_API_URL / http://localhost:8787.
 */

export function storeApiBase(): string {
  if (typeof process !== "undefined" && process.env.STORE_API_URL) {
    return process.env.STORE_API_URL.replace(/\/$/, "");
  }
  return "http://localhost:8787";
}

function mergeHeaders(...parts: Array<HeadersInit | undefined>): Headers {
  const out = new Headers();
  for (const part of parts) {
    if (!part) continue;
    new Headers(part).forEach((value, key) => {
      out.set(key, value);
    });
  }
  return out;
}

function assertNotPublicWorkersUrl(url: string): void {
  if (/workers\.dev/i.test(url) || /cloudflareworkers\.com/i.test(url)) {
    throw new Error(
      "Refusing public Workers URL for store API; use the API service binding",
    );
  }
}

/** True when running inside the OpenNext Cloudflare Worker (not `next dev`). */
async function resolveCloudflareEnv(): Promise<CloudflareEnv | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return env as CloudflareEnv;
  } catch {
    return null;
  }
}

/**
 * Fetch the commerce API.
 * - Cloudflare runtime → `env.API` service binding only (internal).
 * - Local Next.js → HTTP loopback / STORE_API_URL (never *.workers.dev).
 */
export async function storeFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const headers = mergeHeaders(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const nextInit: RequestInit = { ...init, headers };

  const cfEnv = await resolveCloudflareEnv();
  if (cfEnv) {
    if (!cfEnv.API) {
      throw new Error(
        "Missing env.API service binding to cfshop-api (configure wrangler.jsonc services)",
      );
    }
    // Hostname is ignored; the Fetcher routes to cfshop-api on CF's private network.
    return cfEnv.API.fetch(`http://cfshop-api${normalized}`, nextInit);
  }

  const url = path.startsWith("http") ? path : `${storeApiBase()}${normalized}`;
  assertNotPublicWorkersUrl(url);
  return fetch(url, nextInit);
}
