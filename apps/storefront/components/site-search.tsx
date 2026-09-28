"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

function SiteSearchInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const next = q.trim();
    if (!next) {
      router.push("/search");
      return;
    }
    router.push(`/search?q=${encodeURIComponent(next)}`);
  }

  return (
    <form onSubmit={onSubmit} className="relative hidden sm:block" role="search">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 w-40 pl-7 md:w-52"
        type="search"
        name="q"
        placeholder="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search products"
      />
    </form>
  );
}

export function SiteSearch() {
  return (
    <Suspense fallback={null}>
      <SiteSearchInner />
    </Suspense>
  );
}
