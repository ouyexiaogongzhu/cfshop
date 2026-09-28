import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { getProduct, formatPrice } from "@/lib/products";

export async function generateMetadata({
  params,
}: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  return { title: product?.name ?? "Product" };
}

export default async function ProductPage({
  params,
}: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const firstVariantId = product.variants?.[0]?.id;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        {/* Neutral placeholder until real product imagery exists */}
        <div className="flex aspect-square items-center justify-center rounded-lg border bg-muted">
          <span className="text-xs text-muted-foreground">
            {product.category ?? "Product"}
          </span>
        </div>

        <div className="flex flex-col">
          {product.category ? (
            <Badge variant="secondary" className="w-fit">
              {product.category}
            </Badge>
          ) : null}
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {product.name}
          </h1>
          <p className="mt-2 text-xl tabular-nums">
            {formatPrice(product.price)}
          </p>
          <Separator className="my-6" />
          {product.description ? (
            <p className="text-muted-foreground leading-relaxed">
              {product.description}
            </p>
          ) : null}

          <div className="mt-8">
            {firstVariantId ? (
              <AddToCartButton variantId={firstVariantId} size="lg" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Add to cart unavailable until a variant is linked for this
                product.
              </p>
            )}
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
