import { proxyCartRequest } from "@/lib/cart-proxy";

export const dynamic = "force-dynamic";

/** POST /api/cart/items → Worker POST /api/store/cart/items */
export async function POST(request: Request) {
  return proxyCartRequest(request, "/api/store/cart/items");
}
