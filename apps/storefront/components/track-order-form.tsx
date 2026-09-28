"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Scalius track-order pattern without OTP — order id + email lookup. */
export function TrackOrderForm() {
  const router = useRouter();
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/orders/${encodeURIComponent(orderId.trim())}?email=${encodeURIComponent(email.trim())}`,
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!res.ok) {
        setError("Order not found for that email.");
        return;
      }
      router.push(
        `/order/${encodeURIComponent(orderId.trim())}?email=${encodeURIComponent(email.trim())}`,
      );
    } catch {
      setError("Lookup failed. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto w-full max-w-sm space-y-4">
      <label className="block text-sm">
        <span className="text-muted-foreground">Order ID</span>
        <Input
          className="mt-1 font-mono text-xs"
          required
          value={orderId}
          onChange={(e) => setOrderId(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Email</span>
        <Input
          className="mt-1"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Looking up…" : "Track order"}
      </Button>
    </form>
  );
}
