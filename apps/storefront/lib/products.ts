// Placeholder catalog — M1 replaces this with API calls to the worker.

export interface Product {
  slug: string;
  name: string;
  price: number; // USD
  category: string;
  description: string;
  featured?: boolean;
}

export const products: Product[] = [
  {
    slug: "merino-crew-tee",
    name: "Merino Crew Tee",
    price: 48,
    category: "Apparel",
    description:
      "A lightweight merino wool tee that stays fresh for days. Breathable, odor-resistant, and soft against the skin — an ideal everyday layer in any season.",
    featured: true,
  },
  {
    slug: "everyday-canvas-tote",
    name: "Everyday Canvas Tote",
    price: 65,
    category: "Accessories",
    description:
      "Heavyweight cotton canvas tote with an interior zip pocket and reinforced base. Carries groceries, laptops, and everything in between.",
    featured: true,
  },
  {
    slug: "pour-over-kettle",
    name: "Pour-Over Kettle",
    price: 89,
    category: "Home",
    description:
      "A precision-gooseneck kettle with a counterbalanced handle for a steady, controlled pour. Brushed stainless steel, works on all stovetops.",
    featured: true,
  },
  {
    slug: "trail-runner-socks",
    name: "Trail Runner Socks",
    price: 18,
    category: "Apparel",
    description:
      "Cushioned merino blend socks with a seamless toe box and arch support. Built for long miles and sold in singles so you can stock up exactly how you like.",
    featured: true,
  },
  {
    slug: "slim-leather-wallet",
    name: "Slim Leather Wallet",
    price: 55,
    category: "Accessories",
    description:
      "Full-grain leather bifold with six card slots and a slim bill compartment. Ages into a patina that is uniquely yours.",
  },
  {
    slug: "ceramic-mug-set",
    name: "Ceramic Mug Set",
    price: 42,
    category: "Home",
    description:
      "Two 12 oz stoneware mugs with a matte glaze and comfortable handle. Dishwasher and microwave safe.",
  },
  {
    slug: "usb-c-hub",
    name: "7-in-1 USB-C Hub",
    price: 59,
    category: "Tech",
    description:
      "HDMI 4K@60Hz, 100W power delivery, two USB-A ports, and SD/microSD slots in an aluminum shell the size of a matchbox.",
  },
  {
    slug: "packable-rain-shell",
    name: "Packable Rain Shell",
    price: 120,
    category: "Apparel",
    description:
      "A 2.5-layer waterproof shell that packs into its own chest pocket. Fully taped seams, adjustable hood, and pit zips for breathability.",
  },
];

export function getProduct(slug: string): Product | undefined {
  return products.find((p) => p.slug === slug);
}

export const categories: string[] = [...new Set(products.map((p) => p.category))];

export function formatPrice(usd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(usd);
}
