import { proxyStoreRequest } from "@/lib/cart-proxy";

export const dynamic = "force-dynamic";

/** POST /api/checkout → Worker preview-only checkout */
export async function POST(request: Request) {
  return proxyStoreRequest(request, "/api/store/checkout");
}
