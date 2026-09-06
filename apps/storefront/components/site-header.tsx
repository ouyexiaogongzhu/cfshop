import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            cfshop
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/shop" className="hover:text-foreground">
              Shop
            </Link>
            <Link href="/about" className="hover:text-foreground">
              About
            </Link>
          </nav>
        </div>
        {/* Decorative until M2 adds cart state */}
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Cart, 0 items"
        >
          <ShoppingCart className="size-5" />
          <Badge className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 text-[10px] tabular-nums">
            0
          </Badge>
        </Button>
      </div>
    </header>
  );
}
