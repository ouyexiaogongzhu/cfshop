import { proxyStoreRequest } from "@/lib/cart-proxy";

export async function GET(request: Request) {
  return proxyStoreRequest(request, "/api/store/addresses");
}

export async function POST(request: Request) {
  return proxyStoreRequest(request, "/api/store/addresses");
}
