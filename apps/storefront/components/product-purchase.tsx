"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { formatPrice, type Product, type ProductVariant } from "@/lib/products";
import { cn } from "cn";

function optionLabel(options: ProductVariant["options"]): string {
  if (typeof options === "string") {
    try {
      return optionLabel(JSON.parse(options) as Record<string, unknown>);
    } catch {
      return options;
    }
  }
  const values = Object.values(options ?? {}).filter(
    (v): v is string | number => typeof v === "string" || typeof v === "number",
  );
  return values.length > 0 ? values.map(String).join(" / ") : "Default";
}

export function ProductPurchase({ product }: { product: Product }) {
  const variants = product.variants ?? [];
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");

  useEffect(() => {
    if (!variants.some((v) => v.id === variantId)) {
      setVariantId(variants[0]?.id ?? "");
    }
  }, [variants, variantId]);

  const selected = useMemo(
    () => variants.find((v) => v.id === variantId) ?? variants[0],
    [variants, variantId],
  );
  const displayPrice = selected?.amount ?? product.price;

  if (variants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Add to cart unavailable until a variant is linked for this product.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xl tabular-nums">{formatPrice(displayPrice)}</p>
      {variants.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Options</p>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const active = variant.id === selected?.id;
              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => setVariantId(variant.id)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border hover:border-foreground/40",
                  )}
                >
                  {optionLabel(variant.options)}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <Badge variant="secondary" className="w-fit">
          {optionLabel(variants[0]!.options)}
        </Badge>
      )}
      <AddToCartButton variantId={selected?.id ?? ""} size="lg" />
    </div>
  );
}
