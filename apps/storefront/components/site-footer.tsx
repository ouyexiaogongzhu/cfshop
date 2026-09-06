import Link from "next/link";

const links = [
  { href: "#", label: "Shipping" },
  { href: "#", label: "Returns" },
  { href: "#", label: "Privacy" },
  { href: "#", label: "Terms" },
];

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
        <p>© {new Date().getFullYear()} cfshop</p>
        <nav className="flex gap-4">
          {links.map((l) => (
            <Link key={l.label} href={l.href} className="hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
