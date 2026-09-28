import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { ProductCard } from "@/components/product-card";
import { categoriesFrom, listProducts } from "@/lib/products";

export const metadata: Metadata = { title: "Shop" };

export default async function ShopPage() {
  const products = await listProducts();
  const categories = categoriesFrom(products);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Shop</h1>
      {/* Filter chips are UI-only until M1 adds query-driven filtering */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="secondary" className="cursor-pointer px-3 py-1 text-sm">
          All
        </Badge>
        {categories.map((category) => (
          <Badge
            key={category}
            variant="outline"
            className="cursor-pointer px-3 py-1 text-sm"
          >
            {category}
          </Badge>
        ))}
      </div>
      {products.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No products available yet.</p>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
