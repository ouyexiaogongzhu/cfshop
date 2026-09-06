import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">About cfshop</h1>
      <p className="mt-4 leading-relaxed text-muted-foreground">
        cfshop started with a simple idea: fewer, better things. We design and
        source a small catalog of everyday essentials — apparel, home goods,
        and accessories — and sell them directly, without the markup of
        traditional retail.
      </p>
      <p className="mt-4 leading-relaxed text-muted-foreground">
        Every product we stock is something we use ourselves. If it does not
        earn a place in our daily lives, it does not earn a place in the shop.
      </p>
    </div>
  );
}
