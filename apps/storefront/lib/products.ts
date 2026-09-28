import { storeFetch } from "./api";

/** Variant price row from GET /api/store/products/:slug */
export interface ProductVariant {
  id: string;
  sku: string;
  options: Record<string, unknown> | string;
  currency: string;
  /** Integer USD cents */
  amount: number;
  available?: number;
}

/**
 * Catalog product for UI.
 * API uses `title`; `name` is the display alias used by components.
 * `price` is always integer USD cents (list: API price; detail: min variant amount).
 */
export interface Product {
  id: string;
  slug: string;
  title: string;
  name: string;
  /** Integer USD cents */
  price: number;
  category?: string;
  description?: string;
  imageUrl?: string | null;
  variants?: ProductVariant[];
}

interface ApiProductListItem {
  id: string;
  slug: string;
  title: string;
  price: number;
  category?: string | null;
  imageUrl?: string | null;
}

interface ApiProductDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  category?: string | null;
  imageUrl?: string | null;
  variants?: ProductVariant[];
}

function normalizeCategory(category?: string | null): string | undefined {
  const trimmed = category?.trim();
  return trimmed ? trimmed : undefined;
}

function mapListItem(item: ApiProductListItem): Product {
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    name: item.title,
    price: item.price,
    category: normalizeCategory(item.category),
    imageUrl: item.imageUrl ?? null,
  };
}

function mapDetail(item: ApiProductDetail): Product {
  const variants = item.variants ?? [];
  const amounts = variants.map((v) => v.amount).filter((n) => Number.isFinite(n));
  const price = amounts.length > 0 ? Math.min(...amounts) : 0;
  return {
    id: item.id,
    slug: item.slug,
    title: item.title,
    name: item.title,
    description: item.description ?? "",
    category: normalizeCategory(item.category),
    price,
    imageUrl: item.imageUrl ?? null,
    variants,
  };
}

/** Unique categories present on a product list (skips missing/empty). */
export function categoriesFrom(products: Product[]): string[] {
  return [
    ...new Set(
      products
        .map((p) => p.category)
        .filter((c): c is string => Boolean(c))
    ),
  ];
}

/**
 * Active products from GET /api/store/products.
 * Soft-fails to [] when the API is unreachable (e.g. during `next build`).
 */
export async function listProducts(opts?: { category?: string }): Promise<Product[]> {
  try {
    const params = new URLSearchParams();
    if (opts?.category) params.set("category", opts.category);
    const qs = params.toString();
    const res = await storeFetch(`/api/store/products${qs ? `?${qs}` : ""}`);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((row) => mapListItem(row as ApiProductListItem));
  } catch {
    return [];
  }
}

/**
 * Product search from GET /api/store/products/search?q=.
 * Soft-fails to [] when the API is unreachable or returns non-OK.
 */
export async function searchProducts(q: string): Promise<Product[]> {
  const query = q.trim();
  if (!query) return [];
  try {
    const res = await storeFetch(
      `/api/store/products/search?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((row) => mapListItem(row as ApiProductListItem));
  } catch {
    return [];
  }
}

/**
 * Product detail from GET /api/store/products/:slug.
 * Soft-fails to null on 404 / network errors (use with notFound()).
 */
export async function getProduct(slug: string): Promise<Product | null> {
  try {
    const res = await storeFetch(
      `/api/store/products/${encodeURIComponent(slug)}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as ApiProductDetail;
    if (!data?.slug) return null;
    return mapDetail(data);
  } catch {
    return null;
  }
}

/**
 * Format API money for display.
 * Values are integer USD cents — divide by 100 before formatting.
 * Example: `formatPrice(2500)` → `"$25.00"`
 */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}
