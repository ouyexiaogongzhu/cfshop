import { proxyCartRequest } from "@/lib/cart-proxy";

export const dynamic = "force-dynamic";

/** GET /api/cart → Worker GET /api/store/cart */
export async function GET(request: Request) {
  return proxyCartRequest(request, "/api/store/cart");
}

/** POST /api/cart → Worker POST /api/store/cart (create/get + Set-Cookie) */
export async function POST(request: Request) {
  return proxyCartRequest(request, "/api/store/cart");
}
