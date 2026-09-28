import type { Metadata } from "next";
import { ProductCard } from "@/components/product-card";
import { searchProducts } from "@/lib/products";

export const metadata: Metadata = { title: "Search" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const { q: raw } = await searchParams;
  const q = raw?.trim() ?? "";
  const products = q ? await searchProducts(q) : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Search</h1>
      {q ? (
        <p className="mt-2 text-muted-foreground">
          Results for “{q}”
        </p>
      ) : (
        <p className="mt-2 text-muted-foreground">Enter a query to find products.</p>
      )}

      {!q ? null : products.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No products matched.</p>
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
