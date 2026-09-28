import { proxyStoreRequest } from "@/lib/cart-proxy";

export async function GET(request: Request) {
  const search = new URL(request.url).search;
  return proxyStoreRequest(request, "/api/store/orders", { search });
}

export async function POST(request: Request) {
  return proxyStoreRequest(request, "/api/store/orders");
}
