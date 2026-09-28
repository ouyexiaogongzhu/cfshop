import { cn } from "cn";

export function ProductImage({
  src,
  alt,
  category,
  className,
}: {
  src?: string | null;
  alt: string;
  category?: string;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- media proxied via Worker/R2
      <img
        src={src}
        alt={alt}
        className={cn("aspect-square w-full object-cover", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex aspect-square items-center justify-center rounded-lg border bg-muted",
        className,
      )}
    >
      <span className="text-xs text-muted-foreground">{category ?? "Product"}</span>
    </div>
  );
}
