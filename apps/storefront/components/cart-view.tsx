"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  type CartItem,
  type CartState,
  getCart,
  removeCartItem,
  updateCartItemQty,
} from "@/lib/cart-client";

type TitleMap = Record<string, string>;

export function CartView({ titleByVariantId = {} }: { titleByVariantId?: TitleMap }) {
  const [cart, setCart] = useState<CartState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const next = await getCart();
      setCart(next);
      setError(null);
    } catch {
      setError("Couldn’t load cart");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function lineLabel(item: CartItem): string {
    return titleByVariantId[item.variantId] ?? item.variantId;
  }

  function setQty(itemId: string, qty: number) {
    startTransition(async () => {
      try {
        const next = await updateCartItemQty(itemId, qty);
        setCart(next);
      } catch {
        setError("Couldn’t update quantity");
      }
    });
  }

  function remove(itemId: string) {
    startTransition(async () => {
      try {
        const next = await removeCartItem(itemId);
        setCart(next);
      } catch {
        setError("Couldn’t remove item");
      }
    });
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading cart…</p>;
  }

  const items = cart?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Button nativeButton={false} render={<Link href="/shop" />}>
          Continue shopping
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="divide-y rounded-lg border">
        {items.map((item) => (
          <li
            key={item.itemId}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">{lineLabel(item)}</p>
              {!titleByVariantId[item.variantId] ? (
                <p className="text-xs text-muted-foreground font-mono">
                  variant {item.variantId}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground font-mono">
                  {item.variantId}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                aria-label={`Quantity for ${lineLabel(item)}`}
                className="w-20"
                defaultValue={item.qty}
                key={`${item.itemId}-${item.qty}`}
                disabled={pending || cart?.locked}
                onBlur={(e) => {
                  const next = Number.parseInt(e.target.value, 10);
                  if (!Number.isFinite(next) || next === item.qty) return;
                  if (next <= 0) {
                    remove(item.itemId);
                    return;
                  }
                  setQty(item.itemId, next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending || cart?.locked}
                onClick={() => remove(item.itemId)}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {cart?.locked ? (
        <p className="text-sm text-muted-foreground">
          This cart is locked for checkout.
        </p>
      ) : null}

      <Separator />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/shop" />}
        >
          Continue shopping
        </Button>
        <Button type="button" disabled>
          Checkout coming soon
        </Button>
      </div>
    </div>
  );
}
