"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type User = { id: string; email: string };

export function AuthNav() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
      } catch {
        if (!cancelled) setUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    window.location.href = "/";
  }

  if (user === undefined) {
    return <span className="h-8 w-16" aria-hidden />;
  }

  if (user) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/account"
          className="max-w-[10rem] truncate text-muted-foreground hover:text-foreground"
        >
          {user.email}
        </Link>
        <Button type="button" variant="ghost" size="sm" onClick={logout}>
          Log out
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        nativeButton={false}
        render={<Link href="/login" />}
      >
        Log in
      </Button>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link href="/register" />}
      >
        Sign up
      </Button>
    </div>
  );
}
