import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function seedActiveProduct(opts: {
  title: string;
  slug: string;
  amount: number;
  categoryName?: string;
}): Promise<{ id: string; slug: string }> {
  const id = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO products (id, title, slug, description, status)
     VALUES (?, ?, ?, 'desc', 'active')`
  )
    .bind(id, opts.title, opts.slug)
    .run();
  await env.DB.prepare(
    `INSERT INTO product_variants (id, product_id, sku, options)
     VALUES (?, ?, ?, ?)`
  )
    .bind(variantId, id, `SKU-${variantId}`, JSON.stringify({ size: "M" }))
    .run();
  await env.DB.prepare(
    `INSERT INTO prices (id, variant_id, currency, amount) VALUES (?, ?, 'usd', ?)`
  )
    .bind(crypto.randomUUID(), variantId, opts.amount)
    .run();

  if (opts.categoryName) {
    const categoryId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO categories (id, name, slug) VALUES (?, ?, ?)`)
      .bind(categoryId, opts.categoryName, `cat-${categoryId}`)
      .run();
    await env.DB.prepare(
      `INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)`
    )
      .bind(id, categoryId)
      .run();
  }

  return { id, slug: opts.slug };
}

describe("GET /api/store/products", () => {
  it("returns list items with id, slug, title, price, and category", async () => {
    const slug = `goods-${crypto.randomUUID()}`;
    const apparelSlug = `apparel-${crypto.randomUUID()}`;
    const created = await seedActiveProduct({
      title: "Plain Mug",
      slug,
      amount: 1800,
    });
    const apparel = await seedActiveProduct({
      title: "Logo Tee",
      slug: apparelSlug,
      amount: 2500,
      categoryName: "Apparel",
    });

    const res = await SELF.fetch("https://example.com/api/store/products?limit=100");
    expect(res.status).toBe(200);
    const products = (await res.json()) as Array<{
      id: string;
      slug: string;
      title: string;
      price: number;
      category: string;
    }>;

    expect(products.find((p) => p.slug === slug)).toEqual({
      id: created.id,
      slug,
      title: "Plain Mug",
      price: 1800,
      category: "Goods",
    });
    expect(products.find((p) => p.slug === apparelSlug)).toEqual({
      id: apparel.id,
      slug: apparelSlug,
      title: "Logo Tee",
      price: 2500,
      category: "Apparel",
    });
  });
});

describe("GET /api/store/products/:slug", () => {
  it("returns 404 not_found for an unknown slug", async () => {
    const res = await SELF.fetch("https://example.com/api/store/products/missing-slug");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns detail with category and parsed variant options", async () => {
    const slug = `detail-${crypto.randomUUID()}`;
    const created = await seedActiveProduct({
      title: "Detail Tee",
      slug,
      amount: 3000,
      categoryName: "Apparel",
    });

    const res = await SELF.fetch(`https://example.com/api/store/products/${slug}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: created.id,
      slug,
      title: "Detail Tee",
      description: "desc",
      category: "Apparel",
      variants: [
        {
          id: expect.any(String),
          sku: expect.any(String),
          options: { size: "M" },
          currency: "usd",
          amount: 3000,
        },
      ],
    });
  });
});
