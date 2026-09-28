"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/products";

type OrderDetail = {
  orderId: string;
  status: string;
  email: string;
  currency: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  lines?: Array<{
    title: string;
    qty: number;
    unitAmount: number;
    lineTotal: number;
  }>;
};

function OrderDetailInner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const email = search.get("email") ?? "";
  const [order, setOrder] = useState<OrderDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!email) {
        setOrder(null);
        setError("Missing email for order lookup.");
        return;
      }
      const res = await fetch(
        `/api/orders/${encodeURIComponent(params.id)}?email=${encodeURIComponent(email)}`,
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        if (!cancelled) {
          setOrder(null);
          setError("Order not found.");
        }
        return;
      }
      const data = (await res.json()) as OrderDetail;
      if (!cancelled) setOrder(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id, email]);

  if (order === undefined) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">{error ?? "Order not found."}</p>
        <Button nativeButton={false} render={<Link href="/shop" />}>
          Continue shopping
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Order placed</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Thank you</h1>
        <p className="mt-2 text-muted-foreground">
          Confirmation sent concept for <span className="text-foreground">{order.email}</span>.
          Payment is still pending — stock is reserved.
        </p>
      </div>

      <div className="rounded-lg border p-4 text-sm">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="font-mono text-xs">{order.orderId}</span>
          <span className="uppercase tracking-wide text-muted-foreground">{order.status}</span>
        </div>
        <ul className="mt-4 space-y-2">
          {(order.lines ?? []).map((line, idx) => (
            <li key={`${line.title}-${idx}`} className="flex justify-between gap-3">
              <span>
                {line.title} × {line.qty}
              </span>
              <span className="tabular-nums">{formatPrice(line.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 border-t pt-4">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatPrice(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Shipping</span>
            <span className="tabular-nums">{formatPrice(order.shipping)}</span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(order.total)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button nativeButton={false} render={<Link href="/shop" />}>
          Continue shopping
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/account" />}>
          Account
        </Button>
      </div>
    </div>
  );
}

export default function OrderPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-muted" />}>
        <OrderDetailInner />
      </Suspense>
    </div>
  );
}
