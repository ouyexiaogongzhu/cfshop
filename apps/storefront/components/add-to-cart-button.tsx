"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addCartItem } from "@/lib/cart-client";
import { cn } from "cn";

type AddToCartButtonProps = {
  variantId: string;
  qty?: number;
  className?: string;
  size?: "default" | "sm" | "lg" | "xs" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";
  children?: React.ReactNode;
};

export function AddToCartButton({
  variantId,
  qty = 1,
  className,
  size = "default",
  children = "Add to cart",
}: AddToCartButtonProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<"idle" | "added" | "error">("idle");

  useEffect(() => {
    if (message !== "added") return;
    const timer = window.setTimeout(() => setMessage("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [message]);

  function handleClick() {
    if (!variantId || pending) return;
    setMessage("idle");
    startTransition(async () => {
      try {
        await addCartItem(variantId, qty);
        setMessage("added");
      } catch {
        setMessage("error");
      }
    });
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Button
        type="button"
        size={size}
        className="w-full"
        disabled={!variantId || pending}
        onClick={handleClick}
      >
        {pending ? "Adding…" : children}
      </Button>
      {message === "added" ? (
        <p className="text-sm text-muted-foreground" role="status">
          Added
        </p>
      ) : null}
      {message === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          Couldn’t add to cart
        </p>
      ) : null}
    </div>
  );
}
