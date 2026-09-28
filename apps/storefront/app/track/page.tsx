import type { Metadata } from "next";
import { TrackOrderForm } from "@/components/track-order-form";

export const metadata: Metadata = { title: "Track order" };

export default function TrackOrderPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Track order</h1>
        <p className="mt-2 text-muted-foreground">
          Enter the order ID and email from your confirmation.
        </p>
      </div>
      <TrackOrderForm />
    </div>
  );
}
