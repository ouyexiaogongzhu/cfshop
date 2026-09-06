import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { formatPrice, type Product } from "@/lib/products";

export function ProductCard({ product }: { product: Product }) {
  return (
    <Card className="gap-4 pt-0 overflow-hidden">
      <Link href={`/product/${product.slug}`} aria-label={product.name}>
        {/* Neutral placeholder until real product imagery exists */}
        <div className="flex aspect-square items-center justify-center bg-muted">
          <span className="text-xs text-muted-foreground">{product.category}</span>
        </div>
      </Link>
      <CardContent className="space-y-1">
        <h3 className="font-medium leading-none">
          <Link href={`/product/${product.slug}`} className="hover:underline">
            {product.name}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatPrice(product.price)}
        </p>
      </CardContent>
      <CardFooter>
        {/* No handler: stays a server component — wired to cart in M2 */}
        <Button className="w-full" type="button">
          Add to cart
        </Button>
      </CardFooter>
    </Card>
  );
}
