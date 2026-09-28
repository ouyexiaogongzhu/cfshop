"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AdminVariant = { id: string; sku: string; available: number; price?: number };
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
type AdminDiscount = {
  id: string;
  code: string;
  type: "percentage" | "fixed_amount" | string;
  value: number;
  status: "active" | "disabled" | string;
  usageCount?: number;
  usage_count?: number;
};
type AdminCustomer = {
  email: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
};

type AdminTab = "products" | "orders" | "discounts" | "customers";

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

const TAB_LABELS: Record<AdminTab, string> = {
  products: "Products",
  orders: "Orders",
  discounts: "Discounts",
  customers: "Customers",
};

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [tab, setTab] = useState<AdminTab>("products");
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [discounts, setDiscounts] = useState<AdminDiscount[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [busy, setBusy] = useState(false);

  const authed = Boolean(token);

  const load = useCallback(async (activeToken: string, activeTab: AdminTab) => {
    setBusy(true);
    setError(null);
    try {
      if (activeTab === "products") {
        const res = await opsFetch("products", activeToken);
        if (!res.ok) throw new Error(res.status === 401 ? "unauthorized" : "load_failed");
        setProducts((await res.json()) as AdminProduct[]);
      } else if (activeTab === "orders") {
        const res = await opsFetch("orders?limit=50", activeToken);
        if (!res.ok) throw new Error(res.status === 401 ? "unauthorized" : "load_failed");
        setOrders((await res.json()) as AdminOrder[]);
      } else if (activeTab === "discounts") {
        const res = await opsFetch("discounts", activeToken);
        if (!res.ok) throw new Error(res.status === 401 ? "unauthorized" : "load_failed");
        setDiscounts((await res.json()) as AdminDiscount[]);
      } else {
        const res = await opsFetch("customers", activeToken);
        if (!res.ok) throw new Error(res.status === 401 ? "unauthorized" : "load_failed");
        setCustomers((await res.json()) as AdminCustomer[]);
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
    setDiscounts([]);
    setCustomers([]);
  }

  const title = useMemo(() => TAB_LABELS[tab], [tab]);

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(Object.keys(TAB_LABELS) as AdminTab[]).map((key) => (
              <Button
                key={key}
                variant={tab === key ? "default" : "outline"}
                size="sm"
                onClick={() => setTab(key)}
              >
                {TAB_LABELS[key]}
              </Button>
            ))}
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
        ) : null}
        {tab === "orders" ? (
          <OrdersPanel
            token={token}
            orders={orders}
            onChanged={() => void load(token, "orders")}
            onError={setError}
          />
        ) : null}
        {tab === "discounts" ? (
          <DiscountsPanel
            token={token}
            discounts={discounts}
            onChanged={() => void load(token, "discounts")}
            onError={setError}
          />
        ) : null}
        {tab === "customers" ? (
          <CustomersPanel token={token} customers={customers} onError={setError} />
        ) : null}
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
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("2500");
  const [stock, setStock] = useState("10");
  const [creating, setCreating] = useState(false);
  const [addVariantFor, setAddVariantFor] = useState<string | null>(null);
  const [newSku, setNewSku] = useState("");
  const [newPrice, setNewPrice] = useState("2500");
  const [newStock, setNewStock] = useState("0");
  const [addingVariant, setAddingVariant] = useState(false);

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

  async function setVariantPrice(variantId: string, nextPrice: number) {
    onError(null);
    const res = await opsFetch(`variants/${variantId}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: nextPrice }),
    });
    if (!res.ok) {
      onError("Price update failed.");
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

  async function createProduct(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    onError(null);
    try {
      const priceCents = Number(price);
      const available = Number(stock);
      if (!Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(available) || available < 0) {
        onError("Price and stock must be non-negative integers.");
        return;
      }
      const res = await opsFetch("products", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          description,
          status: "active",
          variants: [
            {
              sku: sku || `SKU-${Date.now()}`,
              options: {},
              price: priceCents,
              available,
            },
          ],
        }),
      });
      if (!res.ok) {
        onError("Create product failed.");
        return;
      }
      setShowCreate(false);
      setTitle("");
      setSlug("");
      setDescription("");
      setSku("");
      setPrice("2500");
      setStock("10");
      onChanged();
    } finally {
      setCreating(false);
    }
  }

  async function addVariant(e: React.FormEvent, productId: string) {
    e.preventDefault();
    setAddingVariant(true);
    onError(null);
    try {
      const priceCents = Number(newPrice);
      const available = Number(newStock);
      if (!Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(available) || available < 0) {
        onError("Price and stock must be non-negative integers.");
        return;
      }
      const res = await opsFetch(`products/${productId}/variants`, token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: newSku || `SKU-${Date.now()}`,
          options: {},
          price: priceCents,
          available,
        }),
      });
      if (!res.ok) {
        onError("Add variant failed.");
        return;
      }
      setAddVariantFor(null);
      setNewSku("");
      setNewPrice("2500");
      setNewStock("0");
      onChanged();
    } finally {
      setAddingVariant(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{products.length} products</p>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New product"}
        </Button>
      </div>

      {showCreate ? (
        <form onSubmit={createProduct} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <Input
            className="sm:col-span-2"
            placeholder="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            placeholder="Slug (optional)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <Input placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
          <Input
            className="sm:col-span-2"
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder="Price (cents)"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          <Input
            type="number"
            min={0}
            placeholder="Stock"
            required
            value={stock}
            onChange={(e) => setStock(e.target.value)}
          />
          <Button type="submit" className="sm:col-span-2" disabled={creating}>
            {creating ? "Creating…" : "Create product"}
          </Button>
        </form>
      ) : null}

      {products.length === 0 ? (
        <p className="text-sm text-muted-foreground">No products yet.</p>
      ) : (
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
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        defaultValue={product.title}
                        key={`${product.id}-title`}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (!next || next === product.title) return;
                          void (async () => {
                            onError(null);
                            const res = await opsFetch(`products/${product.id}`, token, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ title: next }),
                            });
                            if (!res.ok) {
                              onError("Product update failed.");
                              return;
                            }
                            onChanged();
                          })();
                        }}
                      />
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
                          Price ¢
                          <Input
                            type="number"
                            min={0}
                            className="h-7 w-24"
                            defaultValue={variant.price ?? ""}
                            key={`${variant.id}-price-${variant.price ?? "na"}`}
                            onBlur={(e) => {
                              const next = Number(e.target.value);
                              if (!Number.isInteger(next) || next < 0) return;
                              if (variant.price !== undefined && next === variant.price) return;
                              void setVariantPrice(variant.id, next);
                            }}
                          />
                        </label>
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

                  {addVariantFor === product.id ? (
                    <form
                      onSubmit={(e) => void addVariant(e, product.id)}
                      className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_auto_auto_auto]"
                    >
                      <Input
                        placeholder="SKU"
                        value={newSku}
                        onChange={(e) => setNewSku(e.target.value)}
                        required
                      />
                      <Input
                        type="number"
                        min={0}
                        placeholder="Price ¢"
                        value={newPrice}
                        onChange={(e) => setNewPrice(e.target.value)}
                        required
                      />
                      <Input
                        type="number"
                        min={0}
                        placeholder="Stock"
                        value={newStock}
                        onChange={(e) => setNewStock(e.target.value)}
                        required
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={addingVariant}>
                          {addingVariant ? "Adding…" : "Add"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setAddVariantFor(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => {
                        setAddVariantFor(product.id);
                        setNewSku("");
                        setNewPrice("2500");
                        setNewStock("0");
                      }}
                    >
                      Add variant
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type OrderDetail = {
  id: string;
  email: string;
  status: string;
  currency: string;
  subtotal: number;
  shippingAmount: number;
  tax: number;
  total: number;
  createdAt: string;
  address?: Record<string, string> | null;
  shipment?: { trackingNumber: string; carrier: string } | null;
  lines: Array<{ title: string; qty: number; unitAmount: number; lineTotal: number }>;
};

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);

  async function openDetail(orderId: string) {
    onError(null);
    setSelectedId(orderId);
    const res = await opsFetch(`orders/${orderId}`, token);
    if (!res.ok) {
      onError("Could not load order detail.");
      setDetail(null);
      return;
    }
    setDetail((await res.json()) as OrderDetail);
  }

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
    if (selectedId === orderId) void openDetail(orderId);
  }

  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">No orders yet.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <ul className="space-y-4">
        {orders.map((order) => (
          <li key={order.id} className="border-b border-border/70 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button type="button" className="text-left" onClick={() => void openDetail(order.id)}>
                <p className="font-medium">{order.email}</p>
                <p className="text-sm text-muted-foreground">
                  {order.id.slice(0, 8)} · {order.status} · {formatMoney(order.total, order.currency)}
                </p>
                <p className="text-xs text-muted-foreground">{order.createdAt}</p>
              </button>
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

      <aside className="h-fit rounded-lg border p-4 text-sm">
        {!detail ? (
          <p className="text-muted-foreground">Select an order for line items and address.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-between gap-2">
              <span className="font-mono text-xs">{detail.id}</span>
              <span className="uppercase text-muted-foreground">{detail.status}</span>
            </div>
            <p>{detail.email}</p>
            {detail.address ? (
              <div className="text-muted-foreground">
                <p className="font-medium text-foreground">Ship to</p>
                <p>{detail.address.name}</p>
                <p>
                  {detail.address.line1}
                  {detail.address.line2 ? `, ${detail.address.line2}` : ""}
                </p>
                <p>
                  {[detail.address.city, detail.address.region, detail.address.postalCode]
                    .filter(Boolean)
                    .join(", ")}{" "}
                  · {detail.address.country}
                </p>
              </div>
            ) : null}
            {detail.shipment ? (
              <p>
                Tracking: <span className="font-mono text-xs">{detail.shipment.trackingNumber}</span>
              </p>
            ) : null}
            <ul className="space-y-1 border-t pt-3">
              {detail.lines.map((line, idx) => (
                <li key={`${line.title}-${idx}`} className="flex justify-between gap-2">
                  <span>
                    {line.title} × {line.qty}
                  </span>
                  <span className="tabular-nums">{formatMoney(line.lineTotal, detail.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between font-medium border-t pt-3">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(detail.total, detail.currency)}</span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function DiscountsPanel({
  token,
  discounts,
  onChanged,
  onError,
}: {
  token: string;
  discounts: AdminDiscount[];
  onChanged: () => void;
  onError: (msg: string | null) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percentage" | "fixed_amount">("percentage");
  const [value, setValue] = useState("10");
  const [creating, setCreating] = useState(false);

  async function createDiscount(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    onError(null);
    try {
      const nextValue = Number(value);
      if (!Number.isInteger(nextValue) || nextValue <= 0) {
        onError("Value must be a positive integer.");
        return;
      }
      if (type === "percentage" && nextValue > 100) {
        onError("Percentage must be 1–100.");
        return;
      }
      const res = await opsFetch("discounts", token, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          type,
          value: nextValue,
        }),
      });
      if (!res.ok) {
        onError("Create discount failed.");
        return;
      }
      setShowCreate(false);
      setCode("");
      setType("percentage");
      setValue("10");
      onChanged();
    } finally {
      setCreating(false);
    }
  }

  async function disableDiscount(id: string) {
    onError(null);
    const res = await opsFetch(`discounts/${id}`, token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });
    if (!res.ok) {
      onError("Disable discount failed.");
      return;
    }
    onChanged();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{discounts.length} discounts</p>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New discount"}
        </Button>
      </div>

      {showCreate ? (
        <form onSubmit={createDiscount} className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
          <Input
            placeholder="Code"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="uppercase"
          />
          <select
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as "percentage" | "fixed_amount")}
          >
            <option value="percentage">percentage</option>
            <option value="fixed_amount">fixed_amount</option>
          </select>
          <Input
            type="number"
            min={1}
            placeholder={type === "percentage" ? "Percent" : "Cents"}
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" className="sm:col-span-3" disabled={creating}>
            {creating ? "Creating…" : "Create discount"}
          </Button>
        </form>
      ) : null}

      {discounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No discounts yet.</p>
      ) : (
        <ul className="space-y-3">
          {discounts.map((discount) => {
            const usage = discount.usageCount ?? discount.usage_count ?? 0;
            return (
              <li
                key={discount.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3"
              >
                <div>
                  <p className="font-mono text-sm font-medium">{discount.code}</p>
                  <p className="text-sm text-muted-foreground">
                    {discount.type} · {discount.value}
                    {discount.type === "percentage" ? "%" : "¢"} · {discount.status} · used {usage}
                  </p>
                </div>
                {discount.status !== "disabled" ? (
                  <Button size="sm" variant="outline" onClick={() => void disableDiscount(discount.id)}>
                    Disable
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground uppercase">disabled</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CustomersPanel({
  token,
  customers,
  onError,
}: {
  token: string;
  customers: AdminCustomer[];
  onError: (msg: string | null) => void;
}) {
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  async function openCustomer(email: string) {
    onError(null);
    setSelectedEmail(email);
    setLoadingOrders(true);
    try {
      const res = await opsFetch(`customers/${encodeURIComponent(email)}/orders`, token);
      if (!res.ok) {
        onError("Could not load customer orders.");
        setOrders([]);
        return;
      }
      setOrders((await res.json()) as AdminOrder[]);
    } finally {
      setLoadingOrders(false);
    }
  }

  if (customers.length === 0) {
    return <p className="text-sm text-muted-foreground">No customers yet.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <ul className="space-y-3">
        {customers.map((customer) => (
          <li key={customer.email} className="border-b border-border/70 pb-3">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => void openCustomer(customer.email)}
            >
              <p className="font-medium">{customer.email}</p>
              <p className="text-sm text-muted-foreground">
                {customer.orderCount} orders · {formatMoney(customer.totalSpent)}
                {customer.lastOrderAt ? ` · last ${customer.lastOrderAt}` : ""}
              </p>
            </button>
          </li>
        ))}
      </ul>

      <aside className="h-fit rounded-lg border p-4 text-sm">
        {!selectedEmail ? (
          <p className="text-muted-foreground">Select a customer to view orders.</p>
        ) : loadingOrders ? (
          <p className="text-muted-foreground">Loading orders…</p>
        ) : (
          <div className="space-y-3">
            <p className="font-medium">{selectedEmail}</p>
            {orders.length === 0 ? (
              <p className="text-muted-foreground">No orders.</p>
            ) : (
              <ul className="space-y-2">
                {orders.map((order) => (
                  <li key={order.id} className="flex justify-between gap-2 border-b border-border/50 pb-2">
                    <span className="font-mono text-xs">{order.id.slice(0, 8)}</span>
                    <span className="text-muted-foreground">{order.status}</span>
                    <span className="tabular-nums">{formatMoney(order.total, order.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
