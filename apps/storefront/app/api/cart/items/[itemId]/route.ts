import { proxyCartRequest } from "@/lib/cart-proxy";

export const dynamic = "force-dynamic";

type ItemParams = { params: Promise<{ itemId: string }> };

/** PATCH /api/cart/items/:itemId → Worker PATCH /api/store/cart/items/:itemId */
export async function PATCH(request: Request, { params }: ItemParams) {
  const { itemId } = await params;
  return proxyCartRequest(
    request,
    `/api/store/cart/items/${encodeURIComponent(itemId)}`,
  );
}

/** DELETE /api/cart/items/:itemId → Worker DELETE /api/store/cart/items/:itemId */
export async function DELETE(request: Request, { params }: ItemParams) {
  const { itemId } = await params;
  return proxyCartRequest(
    request,
    `/api/store/cart/items/${encodeURIComponent(itemId)}`,
  );
}
