import { proxyStoreRequest } from "@/lib/cart-proxy";

export const dynamic = "force-dynamic";

/** GET /api/products/search?q= → Worker GET /api/store/products/search?q= */
export async function GET(request: Request) {
  const search = new URL(request.url).search;
  return proxyStoreRequest(request, "/api/store/products/search", { search });
}
