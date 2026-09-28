import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { AddToCartButton } from "@/components/add-to-cart-button";
import { ProductImage } from "@/components/product-image";
import { formatPrice, type Product } from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  // List endpoint has no variants — only use AddToCart when a variant id is present.
  const variantId = product.variants?.[0]?.id;

  return (
    <Card className="gap-4 overflow-hidden pt-0">
      <Link href={`/product/${product.slug}`} aria-label={product.name}>
        <ProductImage
          src={product.imageUrl}
          alt={product.name}
          category={product.category}
          className="aspect-square rounded-none border-0"
        />
      </Link>
      <CardContent className="space-y-1">
        <h3 className="font-medium leading-none">
          <Link href={`/product/${product.slug}`} className="hover:underline">
            {product.name}
          </Link>
        </h3>
        <p className="text-sm tabular-nums text-muted-foreground">
          {formatPrice(product.price)}
        </p>
      </CardContent>
      <CardFooter>
        {variantId ? (
          <AddToCartButton variantId={variantId} className="w-full" />
        ) : (
          <Button
            className="w-full"
            variant="outline"
            nativeButton={false}
            render={<Link href={`/product/${product.slug}`} />}
          >
            View product
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
