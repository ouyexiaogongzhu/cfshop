"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
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
import { formatPrice } from "@/lib/products";

type ShippingMethod = {
  id: string;
  code: string;
  title: string;
  zone: string;
  currency: string;
  amount: number;
  selected: boolean;
};

const FALLBACK_METHODS: ShippingMethod[] = [
  {
    id: "ship_hk",
    code: "hk",
    title: "Hong Kong",
    zone: "HK",
    currency: "usd",
    amount: 500,
    selected: true,
  },
  {
    id: "ship_intl",
    code: "international",
    title: "International",
    zone: "INTL",
    currency: "usd",
    amount: 2500,
    selected: false,
  },
];

function methodsForCountry(country: string, methods: ShippingMethod[]): ShippingMethod[] {
  const isHk = country.toUpperCase() === "HK";
  return methods.map((method) => ({
    ...method,
    selected: isHk ? method.zone === "HK" : method.zone === "INTL",
  }));
}

type CheckoutPreview = {
  preview: true;
  payment: string;
  currency: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  shippingMethodId: string;
  country: string | null;
  orderId: null;
};

export function CartView() {
  const [cart, setCart] = useState<CartState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [country, setCountry] = useState("HK");
  const [methods, setMethods] = useState<ShippingMethod[]>(() =>
    methodsForCountry("HK", FALLBACK_METHODS),
  );
  const [shippingMethodId, setShippingMethodId] = useState<string>("ship_hk");
  const [preview, setPreview] = useState<CheckoutPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/shipping-methods?country=${encodeURIComponent(country)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!res.ok) throw new Error("shipping_failed");
        const data = (await res.json()) as { methods?: ShippingMethod[] };
        if (cancelled) return;
        const nextMethods =
          data.methods && data.methods.length > 0
            ? data.methods
            : methodsForCountry(country, FALLBACK_METHODS);
        setMethods(nextMethods);
        const selected = nextMethods.find((m) => m.selected) ?? nextMethods[0];
        setShippingMethodId(selected?.id ?? "ship_hk");
      } catch {
        if (cancelled) return;
        const fallback = methodsForCountry(country, FALLBACK_METHODS);
        setMethods(fallback);
        setShippingMethodId(fallback.find((m) => m.selected)?.id ?? "ship_hk");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [country]);

  const subtotal = useMemo(() => {
    return (cart?.items ?? []).reduce(
      (sum, item) => sum + (item.unitAmount ?? 0) * item.qty,
      0,
    );
  }, [cart]);

  function lineLabel(item: CartItem): string {
    return item.title ?? item.variantId;
  }

  function setQty(itemId: string, qty: number) {
    startTransition(async () => {
      try {
        const next = await updateCartItemQty(itemId, qty);
        setCart(next);
        setPreview(null);
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
        setPreview(null);
      } catch {
        setError("Couldn’t remove item");
      }
    });
  }

  function runPreview() {
    if (!shippingMethodId) return;
    setPreviewError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/checkout", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ shippingMethodId, country }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "preview_failed");
        }
        setPreview((await res.json()) as CheckoutPreview);
      } catch {
        setPreview(null);
        setPreviewError("Couldn’t preview checkout");
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
              <p className="text-sm text-muted-foreground tabular-nums">
                {formatPrice(item.unitAmount ?? 0)} each
              </p>
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

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="tabular-nums font-medium">{formatPrice(subtotal)}</span>
      </div>

      <Separator />

      <div className="space-y-3 rounded-lg border p-4">
        <p className="font-medium">Shipping preview</p>
        <label className="block text-sm">
          <span className="text-muted-foreground">Country (ISO)</span>
          <Input
            className="mt-1 max-w-[8rem] uppercase"
            value={country}
            maxLength={2}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {methods.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => {
                setShippingMethodId(method.id);
                setPreview(null);
              }}
              className={
                method.id === shippingMethodId
                  ? "rounded-md border border-foreground bg-foreground px-3 py-1.5 text-sm text-background"
                  : "rounded-md border px-3 py-1.5 text-sm"
              }
            >
              {method.title} · {formatPrice(method.amount)}
            </button>
          ))}
        </div>
        <Button type="button" disabled={pending || !shippingMethodId} onClick={runPreview}>
          {pending ? "Calculating…" : "Preview totals"}
        </Button>
        {previewError ? (
          <p className="text-sm text-destructive" role="alert">
            {previewError}
          </p>
        ) : null}
        {preview ? (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatPrice(preview.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span className="tabular-nums">{formatPrice(preview.shipping)}</span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span className="tabular-nums">{formatPrice(preview.tax)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(preview.total)}</span>
            </div>
            <p className="pt-2 text-muted-foreground">
              Payment is not enabled yet — this is a preview only.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link href="/shop" />}
        >
          Continue shopping
        </Button>
      </div>
    </div>
  );
}
