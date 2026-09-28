import { proxyStoreRequest } from "@/lib/cart-proxy";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const search = new URL(request.url).search;
  return proxyStoreRequest(request, `/api/store/orders/${encodeURIComponent(id)}`, { search });
}
