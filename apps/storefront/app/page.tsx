import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ProductCard } from "@/components/product-card";
import { products } from "@/lib/products";

export default function Home() {
  const featured = products.filter((p) => p.featured);

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="flex flex-col items-center gap-4 py-20 text-center sm:py-28">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Everyday essentials, thoughtfully made
        </h1>
        <p className="max-w-xl text-muted-foreground text-balance">
          A small, considered collection of goods for work, home, and travel —
          built to last and priced honestly.
        </p>
        <Link href="/shop" className={buttonVariants({ size: "lg" }) + " mt-2"}>
          Shop now
        </Link>
      </section>

      <section className="pb-20">
        <h2 className="mb-6 text-2xl font-semibold tracking-tight">
          Featured products
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {featured.map((product) => (
            <ProductCard key={product.slug} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
