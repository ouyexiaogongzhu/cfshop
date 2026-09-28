"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/products";

type User = { id: string; email: string };

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

type OrderSummary = {
  orderId: string;
  status: string;
  total: number;
  createdAt: string;
};

/** Scalius-style account: orders list + address book (Merchant address CRUD). */
export default function AccountPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("HK");

  async function loadAccount() {
    const me = await fetch("/api/auth/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!me.ok) {
      setUser(null);
      return;
    }
    const nextUser = (await me.json()) as User;
    setUser(nextUser);

    const [addrRes, orderRes] = await Promise.all([
      fetch("/api/addresses", { credentials: "include" }),
      fetch("/api/orders", { credentials: "include" }),
    ]);
    if (addrRes.ok) setAddresses((await addrRes.json()) as Address[]);
    if (orderRes.ok) setOrders((await orderRes.json()) as OrderSummary[]);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadAccount();
      } catch {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addAddress(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/addresses", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, line1, line2, city, region, postalCode, country }),
      });
      if (!res.ok) throw new Error("save_failed");
      setName("");
      setLine1("");
      setLine2("");
      setCity("");
      setRegion("");
      setPostalCode("");
      setCountry("HK");
      await loadAccount();
    } catch {
      setError("Could not save address.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAddress(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/addresses/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error("delete_failed");
      await loadAccount();
    } catch {
      setError("Could not delete address.");
    } finally {
      setBusy(false);
    }
  }

  if (user === undefined) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-2 text-muted-foreground">Sign in to view orders and addresses.</p>
        <Button
          className="mt-6"
          nativeButton={false}
          render={<Link href="/login?next=/account" />}
        >
          Log in
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-12 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
        <p className="mt-2 text-muted-foreground">Signed in as {user.email}</p>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Orders</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {orders.map((order) => (
              <li key={order.orderId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-mono text-xs">{order.orderId.slice(0, 8)}…</p>
                  <p className="text-sm text-muted-foreground">
                    {order.status} · {order.createdAt}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums text-sm">{formatPrice(order.total)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={
                      <Link
                        href={`/order/${encodeURIComponent(order.orderId)}?email=${encodeURIComponent(user.email)}`}
                      />
                    }
                  >
                    View
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Addresses</h2>
        {addresses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved addresses.</p>
        ) : (
          <ul className="space-y-3">
            {addresses.map((address) => (
              <li key={address.id} className="rounded-lg border p-4 text-sm">
                <p className="font-medium">{address.name}</p>
                <p className="text-muted-foreground">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {address.city}
                  {address.region ? `, ${address.region}` : ""} {address.postalCode} ·{" "}
                  {address.country}
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void removeAddress(address.id)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addAddress} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <p className="sm:col-span-2 text-sm font-medium">Add address</p>
          <Input placeholder="Full name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Country (ISO)"
            required
            maxLength={2}
            className="uppercase"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
          />
          <Input
            className="sm:col-span-2"
            placeholder="Address line 1"
            required
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
          />
          <Input
            className="sm:col-span-2"
            placeholder="Address line 2"
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
          />
          <Input placeholder="City" required value={city} onChange={(e) => setCity(e.target.value)} />
          <Input placeholder="Region" value={region} onChange={(e) => setRegion(e.target.value)} />
          <Input
            placeholder="Postal code"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="sm:col-span-2">
            {busy ? "Saving…" : "Save address"}
          </Button>
        </form>
      </section>

      <Link href="/shop" className="text-sm text-muted-foreground hover:text-foreground">
        Continue shopping
      </Link>
    </div>
  );
}
