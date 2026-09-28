"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getCart, type CartState } from "@/lib/cart-client";
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

type Address = {
  id: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

type PlacedOrder = {
  orderId: string;
  email: string;
  status: string;
  total: number;
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

/** Adapted from Merchant example checkout: email + place order (payment deferred). */
export function CheckoutForm() {
  const router = useRouter();
  const [cart, setCart] = useState<CartState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("HK");
  const [methods, setMethods] = useState<ShippingMethod[]>(() =>
    methodsForCountry("HK", FALLBACK_METHODS),
  );
  const [shippingMethodId, setShippingMethodId] = useState("ship_hk");
  const [savedAddresses, setSavedAddresses] = useState<Address[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await getCart();
      setCart(next);
    } catch {
      setCart(null);
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
      const me = await fetch("/api/auth/me", { credentials: "include" });
      if (!me.ok || cancelled) return;
      const user = (await me.json()) as { email: string };
      if (!cancelled) setEmail(user.email);
      const addr = await fetch("/api/addresses", { credentials: "include" });
      if (!addr.ok || cancelled) return;
      const list = (await addr.json()) as Address[];
      if (cancelled) return;
      setSavedAddresses(list);
      const first = list[0];
      if (first) {
        setName(first.name);
        setLine1(first.line1);
        setLine2(first.line2);
        setCity(first.city);
        setRegion(first.region);
        setPostalCode(first.postalCode);
        setCountry(first.country);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const shippingAmount = useMemo(() => {
    return methods.find((m) => m.id === shippingMethodId)?.amount ?? 0;
  }, [methods, shippingMethodId]);

  const subtotal = useMemo(() => {
    return (cart?.items ?? []).reduce(
      (sum, item) => sum + (item.unitAmount ?? 0) * item.qty,
      0,
    );
  }, [cart]);

  function applySaved(address: Address) {
    setName(address.name);
    setLine1(address.line1);
    setLine2(address.line2);
    setCity(address.city);
    setRegion(address.region);
    setPostalCode(address.postalCode);
    setCountry(address.country);
  }

  function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const idempotencyKey =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        const res = await fetch("/api/orders", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            email,
            shippingMethodId,
            country,
            address: {
              name,
              line1,
              line2,
              city,
              region,
              postalCode,
              country,
            },
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (body?.error === "empty_cart") throw new Error("Your cart is empty.");
          if (body?.error === "insufficient_inventory") {
            throw new Error("Some items are out of stock.");
          }
          throw new Error("Could not place order. Check your details.");
        }
        const placed = (await res.json()) as PlacedOrder;
        router.replace(
          `/order/${encodeURIComponent(placed.orderId)}?email=${encodeURIComponent(placed.email)}`,
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Checkout failed.");
      }
    });
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading checkout…</p>;
  }

  if (!cart?.items.length) {
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
    <form onSubmit={placeOrder} className="grid gap-10 md:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Contact</h2>
          <label className="block text-sm">
            <span className="text-muted-foreground">Email</span>
            <Input
              className="mt-1"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Shipping address</h2>
          {savedAddresses.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {savedAddresses.map((address) => (
                <Button
                  key={address.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => applySaved(address)}
                >
                  Use {address.name}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted-foreground">Full name</span>
              <Input className="mt-1" required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted-foreground">Address line 1</span>
              <Input className="mt-1" required value={line1} onChange={(e) => setLine1(e.target.value)} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted-foreground">Address line 2</span>
              <Input className="mt-1" value={line2} onChange={(e) => setLine2(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">City</span>
              <Input className="mt-1" required value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Region / state</span>
              <Input className="mt-1" value={region} onChange={(e) => setRegion(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Postal code</span>
              <Input
                className="mt-1"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">Country (ISO)</span>
              <Input
                className="mt-1 uppercase"
                required
                maxLength={2}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
              />
            </label>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium">Shipping method</h2>
          <div className="flex flex-wrap gap-2">
            {methods.map((method) => (
              <button
                key={method.id}
                type="button"
                onClick={() => setShippingMethodId(method.id)}
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
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-lg border p-4">
        <h2 className="font-medium">Order summary</h2>
        <ul className="space-y-2 text-sm">
          {cart.items.map((item) => (
            <li key={item.itemId} className="flex justify-between gap-3">
              <span className="truncate">
                {item.title ?? item.variantId} × {item.qty}
              </span>
              <span className="tabular-nums">
                {formatPrice((item.unitAmount ?? 0) * item.qty)}
              </span>
            </li>
          ))}
        </ul>
        <Separator />
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatPrice(subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Shipping</span>
            <span className="tabular-nums">{formatPrice(shippingAmount)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(subtotal + shippingAmount)}</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Payment is not enabled yet. Placing an order reserves stock and creates a pending
          order (Merchant-style checkout without Stripe redirect).
        </p>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Placing order…" : "Place order"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          nativeButton={false}
          render={<Link href="/cart" />}
        >
          Back to cart
        </Button>
      </aside>
    </form>
  );
}
