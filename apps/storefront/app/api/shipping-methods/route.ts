import { proxyStoreRequest } from "@/lib/cart-proxy";

export const dynamic = "force-dynamic";

/** GET /api/shipping-methods?country= → Worker shipping methods */
export async function GET(request: Request) {
  const { search } = new URL(request.url);
  return proxyStoreRequest(request, "/api/store/shipping-methods", { search });
}
