import { storeFetch } from "@/lib/api";

type Params = { params: Promise<{ path: string[] }> };

/** Only forward known admin surfaces — blocks open proxy to future admin routes. */
const ALLOWED = [
  /^products(?:\/[A-Za-z0-9_-]+(?:\/variants)?)?$/,
  /^inventory\/[A-Za-z0-9_-]+$/,
  /^orders(?:\/[A-Za-z0-9_-]+(?:\/shipments)?)?$/,
  /^media$/,
  /^discounts(?:\/[A-Za-z0-9_-]+)?$/,
  /^customers(?:\/[^/]+\/orders)?$/,
  /^variants\/[A-Za-z0-9_-]+$/,
];

function isAllowedOpsPath(path: string): boolean {
  const bare = path.split("?")[0] ?? path;
  return ALLOWED.some((re) => re.test(bare));
}

/**
 * Admin ops proxy: browser → storefront → API service binding.
 * Requires Authorization from the caller; never injects a server-side admin secret.
 */
async function proxyOps(request: Request, pathParts: string[]) {
  const path = pathParts.map(decodeURIComponent).join("/");
  if (!path || path.includes("..") || !isAllowedOpsPath(path)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length < 16) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const headers = new Headers();
  headers.set("Authorization", auth);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Accept", request.headers.get("accept") ?? "application/json");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const search = new URL(request.url).search;

  return storeFetch(`/api/admin/${path}${search}`, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
  });
}

export async function GET(request: Request, { params }: Params) {
  const { path } = await params;
  return proxyOps(request, path);
}

export async function POST(request: Request, { params }: Params) {
  const { path } = await params;
  return proxyOps(request, path);
}

export async function PATCH(request: Request, { params }: Params) {
  const { path } = await params;
  return proxyOps(request, path);
}

export async function PUT(request: Request, { params }: Params) {
  const { path } = await params;
  return proxyOps(request, path);
}

export async function DELETE(request: Request, { params }: Params) {
  const { path } = await params;
  return proxyOps(request, path);
}
