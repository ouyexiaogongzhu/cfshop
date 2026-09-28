import { proxyStoreRequest } from "@/lib/cart-proxy";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return proxyStoreRequest(request, `/api/store/addresses/${encodeURIComponent(id)}`);
}
