export type CartItem = {
  itemId: string;
  variantId: string;
  qty: number;
};

export type CartState = {
  items: CartItem[];
  locked: boolean;
  cartId?: string;
};

export const CART_UPDATED_EVENT = "cfshop:cart-updated";

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0);
}

export function notifyCartUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CART_UPDATED_EVENT));
  }
}

async function cartFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path ? `/api/cart${path}` : "/api/cart";
  return fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export async function ensureCart(): Promise<CartState> {
  const res = await cartFetch("", { method: "POST" });
  if (!res.ok) {
    throw new Error("Failed to create cart");
  }
  return (await res.json()) as CartState;
}

export async function getCart(): Promise<CartState | null> {
  const res = await cartFetch("");
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error("Failed to load cart");
  }
  return (await res.json()) as CartState;
}

export async function addCartItem(
  variantId: string,
  qty = 1,
): Promise<CartState> {
  await ensureCart();
  const res = await cartFetch("/items", {
    method: "POST",
    body: JSON.stringify({ variantId, qty }),
  });
  if (!res.ok) {
    throw new Error("Failed to add item");
  }
  const state = (await res.json()) as CartState;
  notifyCartUpdated();
  return state;
}

export async function updateCartItemQty(
  itemId: string,
  qty: number,
): Promise<CartState> {
  const res = await cartFetch(`/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify({ qty }),
  });
  if (!res.ok) {
    throw new Error("Failed to update item");
  }
  const state = (await res.json()) as CartState;
  notifyCartUpdated();
  return state;
}

export async function removeCartItem(itemId: string): Promise<CartState> {
  const res = await cartFetch(`/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error("Failed to remove item");
  }
  const state = (await res.json()) as CartState;
  notifyCartUpdated();
  return state;
}
