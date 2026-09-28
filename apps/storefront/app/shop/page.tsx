import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ProductCard } from "@/components/product-card";
import { categoriesFrom, listProducts } from "@/lib/products";

export const metadata: Metadata = { title: "Shop" };

type Props = { searchParams: Promise<{ category?: string }> };

export default async function ShopPage({ searchParams }: Props) {
  const { category: rawCategory } = await searchParams;
  const category = rawCategory?.trim() || undefined;
  const [filtered, all] = await Promise.all([
    listProducts(category ? { category } : undefined),
    category ? listProducts() : Promise.resolve(null),
  ]);
  const products = filtered;
  const categories = categoriesFrom(all ?? filtered);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Shop</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/shop">
          <Badge
            variant={category ? "outline" : "secondary"}
            className="cursor-pointer px-3 py-1 text-sm"
          >
            All
          </Badge>
        </Link>
        {categories.map((name) => (
          <Link key={name} href={`/shop?category=${encodeURIComponent(name)}`}>
            <Badge
              variant={category === name ? "secondary" : "outline"}
              className="cursor-pointer px-3 py-1 text-sm"
            >
              {name}
            </Badge>
          </Link>
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
