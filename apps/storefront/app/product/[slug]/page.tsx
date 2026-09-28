import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ProductPurchase } from "@/components/product-purchase";
import { ProductImage } from "@/components/product-image";
import { getProduct } from "@/lib/products";

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

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <ProductImage
          src={product.imageUrl}
          alt={product.name}
          category={product.category}
          className="rounded-lg border"
        />

        <div className="flex flex-col">
          {product.category ? (
            <Badge variant="secondary" className="w-fit">
              {product.category}
            </Badge>
          ) : null}
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {product.name}
          </h1>
          <Separator className="my-6" />
          {product.description ? (
            <p className="leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          ) : null}

          <div className="mt-8">
            <ProductPurchase product={product} />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Flat-rate shipping: Hong Kong $5 · International $25
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
