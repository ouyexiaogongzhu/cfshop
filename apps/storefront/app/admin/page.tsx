"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdminVariant = { id: string; sku: string; available: number };
type AdminProduct = {
  id: string;
  slug: string;
  title: string;
  status: string;
  imageKey: string | null;
  imageUrl: string | null;
  variants: AdminVariant[];
};
type AdminOrder = {
  id: string;
  email: string;
  status: string;
  currency: string;
  total: number;
  createdAt: string;
};

function formatMoney(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

async function opsFetch(path: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(`/api/ops/${path.replace(/^\//, "")}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [busy, setBusy] = useState(false);

  const authed = Boolean(token);

  const load = useCallback(async (activeToken: string, activeTab: typeof tab) => {
    setBusy(true);
    setError(null);
    try {
      if (activeTab === "products") {
        const res = await opsFetch("products", activeToken);
        if (!res.ok) throw new Error(res.status === 401 ? "unauthorized" : "load_failed");
        setProducts((await res.json()) as AdminProduct[]);
      } else {
        const res = await opsFetch("orders?limit=50", activeToken);
        if (!res.ok) throw new Error(res.status === 401 ? "unauthorized" : "load_failed");
        setOrders((await res.json()) as AdminOrder[]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "load_failed";
      if (msg === "unauthorized") {
        setToken("");
        setError("Invalid admin token.");
      } else {
        setError("Could not load admin data.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    void load(token, tab);
  }, [token, tab, load]);

  function unlock(e: React.FormEvent) {
    e.preventDefault();
    const next = draftToken.trim();
    if (!next) return;
    setToken(next);
  }

  function lock() {
    setToken("");
    setDraftToken("");
    setProducts([]);
    setOrders([]);
  }

  const title = useMemo(() => (tab === "products" ? "Products" : "Orders"), [tab]);

  if (!authed) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-4 py-16">
        <p className="text-sm font-medium tracking-wide text-muted-foreground">cfshop</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter the Worker <code className="text-foreground">ADMIN_TOKEN</code> to manage
          catalog, inventory, and shipments.
        </p>
        <form onSubmit={unlock} className="mt-8 space-y-4">
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Admin token"
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full">
            Unlock
          </Button>
        </form>
        <Link href="/" className="mt-6 text-center text-sm text-muted-foreground hover:text-foreground">
          ← Back to store
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[linear-gradient(180deg,#f7f7f5_0%,#ffffff_40%)]">
      <header className="border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
              cfshop admin
            </p>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={tab === "products" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("products")}
            >
              Products
            </Button>
            <Button
              variant={tab === "orders" ? "default" : "outline"}
              size="sm"
              onClick={() => setTab("orders")}
            >
              Orders
            </Button>
            <Button variant="ghost" size="sm" onClick={lock}>
              Lock
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}
        {busy ? <p className="mb-4 text-sm text-muted-foreground">Loading…</p> : null}

        {tab === "products" ? (
          <ProductsPanel
            token={token}
            products={products}
            onChanged={() => void load(token, "products")}
            onError={setError}
          />
        ) : (
          <OrdersPanel
            token={token}
            orders={orders}
            onChanged={() => void load(token, "orders")}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}

function ProductsPanel({
  token,
  products,
  onChanged,
  onError,
}: {
  token: string;
  products: AdminProduct[];
  onChanged: () => void;
  onError: (msg: string | null) => void;
}) {
  async function setAvailable(variantId: string, available: number) {
    onError(null);
    const res = await opsFetch(`inventory/${variantId}`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available }),
    });
    if (!res.ok) {
      onError("Inventory update failed.");
      return;
    }
    onChanged();
  }

  async function setStatus(productId: string, status: string) {
    onError(null);
    const res = await opsFetch(`products/${productId}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      onError("Status update failed.");
      return;
    }
    onChanged();
  }

  async function uploadImage(product: AdminProduct, file: File) {
    onError(null);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const safeExt = ["png", "jpg", "jpeg", "webp"].includes(ext) ? ext : "png";
    const key = `products/${product.slug}.${safeExt}`;
    const form = new FormData();
    form.set("key", key);
    form.set("file", file);
    const up = await opsFetch("media", token, { method: "POST", body: form });
    if (!up.ok) {
      onError("Image upload failed.");
      return;
    }
    const patch = await opsFetch(`products/${product.id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageKey: key }),
    });
    if (!patch.ok) {
      onError("Image linked, but product update failed.");
      return;
    }
    onChanged();
  }

  if (products.length === 0) {
    return <p className="text-sm text-muted-foreground">No products yet.</p>;
  }

  return (
    <ul className="space-y-6">
      {products.map((product) => (
        <li key={product.id} className="border-b border-border/70 pb-6">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="size-24 shrink-0 overflow-hidden rounded-md bg-muted">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center text-[10px] text-muted-foreground">
                  No image
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{product.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {product.slug} · {product.status}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["draft", "active", "archived"] as const).map((status) => (
                    <Button
                      key={status}
                      size="xs"
                      variant={product.status === status ? "default" : "outline"}
                      onClick={() => void setStatus(product.id, status)}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <span className="underline-offset-4 hover:underline">Upload image</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadImage(product, file);
                    e.target.value = "";
                  }}
                />
              </label>

              <ul className="space-y-2">
                {product.variants.map((variant) => (
                  <li
                    key={variant.id}
                    className="flex flex-wrap items-center gap-3 text-sm"
                  >
                    <span className="min-w-28 font-mono text-xs">{variant.sku}</span>
                    <label className="flex items-center gap-2">
                      Stock
                      <Input
                        type="number"
                        min={0}
                        className="h-7 w-20"
                        defaultValue={variant.available}
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isInteger(next) || next < 0) return;
                          if (next === variant.available) return;
                          void setAvailable(variant.id, next);
                        }}
                      />
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function OrdersPanel({
  token,
  orders,
  onChanged,
  onError,
}: {
  token: string;
  orders: AdminOrder[];
  onChanged: () => void;
  onError: (msg: string | null) => void;
}) {
  const [tracking, setTracking] = useState<Record<string, string>>({});

  async function ship(orderId: string) {
    const trackingNumber = (tracking[orderId] ?? "").trim();
    if (!trackingNumber) {
      onError("Tracking number required.");
      return;
    }
    onError(null);
    const res = await opsFetch(`orders/${orderId}/shipments`, token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingNumber, carrier: "manual" }),
    });
    if (!res.ok) {
      onError("Shipment update failed.");
      return;
    }
    onChanged();
  }

  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">No orders yet.</p>;
  }

  return (
    <ul className="space-y-4">
      {orders.map((order) => (
        <li key={order.id} className="border-b border-border/70 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium">{order.email}</p>
              <p className="text-sm text-muted-foreground">
                {order.id.slice(0, 8)} · {order.status} · {formatMoney(order.total, order.currency)}
              </p>
              <p className="text-xs text-muted-foreground">{order.createdAt}</p>
            </div>
            {order.status !== "shipped" && order.status !== "refunded" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 w-44"
                  placeholder="Tracking #"
                  value={tracking[order.id] ?? ""}
                  onChange={(e) =>
                    setTracking((prev) => ({ ...prev, [order.id]: e.target.value }))
                  }
                />
                <Button size="sm" onClick={() => void ship(order.id)}>
                  Mark shipped
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
