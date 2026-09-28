import type { Metadata } from "next";
import { RegisterForm } from "@/components/register-form";

export const metadata: Metadata = {
  title: "Sign up",
};

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Create account</h1>
        <p className="mt-2 text-muted-foreground">
          Save addresses and track orders later.
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
