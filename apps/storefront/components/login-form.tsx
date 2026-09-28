"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Same-origin relative paths only (blocks //evil and backslash tricks). */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/account";
  }
  return raw;
}

type Mode = "password" | "otp";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNextPath(search.get("next"));
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchMode(nextMode: Mode) {
    setMode(nextMode);
    setError(null);
    setInfo(null);
    setOtpSent(false);
    setCode("");
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          body?.error === "invalid_credentials"
            ? "Email or password is incorrect."
            : "Could not log in. Try again.",
        );
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not log in. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        setError("Could not send a code. Try again.");
        return;
      }
      setOtpSent(true);
      setInfo("If that email can sign in, a 6-digit code was sent. It expires in 10 minutes.");
    } catch {
      setError("Could not send a code. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, code }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          body?.error === "invalid_otp"
            ? "That code is invalid or expired."
            : "Could not verify the code. Try again.",
        );
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not verify the code. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm space-y-4">
      <div className="flex gap-2 border-b border-border pb-2">
        <button
          type="button"
          className={`flex-1 px-2 py-1.5 text-sm font-medium transition-colors ${
            mode === "password"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => switchMode("password")}
        >
          Password
        </button>
        <button
          type="button"
          className={`flex-1 px-2 py-1.5 text-sm font-medium transition-colors ${
            mode === "otp"
              ? "border-b-2 border-foreground text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => switchMode("otp")}
        >
          Email code
        </button>
      </div>

      {mode === "password" ? (
        <form onSubmit={onPasswordSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Log in"}
          </Button>
        </form>
      ) : (
        <div className="space-y-4">
          <form onSubmit={onRequestCode} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="otp-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="otp-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending} variant="outline">
              {pending && !otpSent ? "Sending…" : otpSent ? "Resend code" : "Send code"}
            </Button>
          </form>
          {otpSent ? (
            <form onSubmit={onVerifyCode} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="otp-code" className="text-sm font-medium">
                  6-digit code
                </label>
                <Input
                  id="otp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </div>
              <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
                {pending ? "Verifying…" : "Verify and log in"}
              </Button>
            </form>
          ) : null}
          {info ? <p className="text-sm text-muted-foreground">{info}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      )}

      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
