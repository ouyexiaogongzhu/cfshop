import { storeFetch } from "@/lib/api";

type Params = { params: Promise<{ path: string[] }> };

/**
 * Admin ops proxy: browser → storefront → API service binding.
 * Forwards Authorization (and multipart bodies) without exposing workers.dev.
 */
async function proxyOps(request: Request, pathParts: string[]) {
  const path = pathParts.map(decodeURIComponent).join("/");
  if (!path || path.includes("..")) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const headers = new Headers();
  const auth = request.headers.get("authorization");
  if (auth) headers.set("Authorization", auth);
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
