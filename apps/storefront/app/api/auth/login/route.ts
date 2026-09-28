import { proxyStoreRequest } from "@/lib/cart-proxy";

export async function POST(request: Request) {
  return proxyStoreRequest(request, "/api/store/auth/login");
}
