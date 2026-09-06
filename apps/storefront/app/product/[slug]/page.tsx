import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { getProduct, formatPrice, products } from "@/lib/products";

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = getProduct(slug);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({
  params,
}: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  const product = getProduct(slug);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        {/* Neutral placeholder until real product imagery exists */}
        <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted">
          <span className="text-xs text-muted-foreground">{product.category}</span>
        </div>

        <div className="flex flex-col">
          <Badge variant="secondary" className="w-fit">
            {product.category}
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {product.name}
          </h1>
          <p className="mt-2 text-xl tabular-nums">
            {formatPrice(product.price)}
          </p>
          <Separator className="my-6" />
          <p className="text-muted-foreground leading-relaxed">
            {product.description}
          </p>

          <div className="mt-8 flex items-center gap-3">
            {/* Qty + add-to-cart are placeholders — cart state lands in M2 */}
            <Input
              type="number"
              defaultValue={1}
              min={1}
              aria-label="Quantity"
              className="w-20"
            />
            <Button size="lg" type="button" className="flex-1">
              Add to cart
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Free US shipping on orders over $75 · 30-day returns
          </p>
          <Link
            href="/shop"
            className="mt-6 text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to shop
          </Link>
        </div>
      </div>
    </div>
  );
}
