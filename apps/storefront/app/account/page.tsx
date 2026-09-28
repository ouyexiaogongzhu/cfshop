"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type User = { id: string; email: string };

export default function AccountPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        if (!cancelled) setUser(null);
        return;
      }
      const data = (await res.json()) as User;
      if (!cancelled) setUser(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (user === undefined) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-2 text-muted-foreground">Sign in to view your account.</p>
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
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
      <p className="mt-2 text-muted-foreground">Signed in as {user.email}</p>
      <div className="mt-8 space-y-3 text-sm text-muted-foreground">
        <p>Addresses and order history will show here as checkout lands.</p>
        <Link href="/shop" className="text-foreground underline-offset-4 hover:underline">
          Continue shopping
        </Link>
      </div>
    </div>
  );
}
