import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
};

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Checkout</h1>
      <p className="mt-2 text-muted-foreground">
        Enter shipping details to place a pending order.
      </p>
      <div className="mt-8">
        <CheckoutForm />
      </div>
    </div>
  );
}
