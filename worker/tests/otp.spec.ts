import { SELF, env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const base = "https://example.com/api/store";

function sessionCookie(res: Response): string {
  const fromList =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie().find((value) => value.includes("cfshop_session="))
      : undefined;
  const header = fromList ?? res.headers.get("set-cookie") ?? "";
  const pair = header.split(";")[0]?.trim() ?? "";
  if (!pair.startsWith("cfshop_session=")) throw new Error(`missing session cookie: ${header}`);
  return pair;
}

async function post(path: string, body: unknown): Promise<Response> {
  return SELF.fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function captureDevOtp(email: string): { get: () => string | null } {
  let code: string | null = null;
  const original = console.log;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      try {
        const parsed = JSON.parse(first) as { msg?: string; email?: string; code?: string };
        if (parsed.msg === "otp_dev" && parsed.email === email && typeof parsed.code === "string") {
          code = parsed.code;
          return;
        }
      } catch {
        // fall through
      }
    }
    original.apply(console, args as Parameters<typeof console.log>);
  });
  return {
    get: () => code,
  };
}

describe("OTP auth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests and verifies an OTP, creating a session for a new email", async () => {
    const email = `otp-new-${crypto.randomUUID()}@example.com`;
    const captured = captureDevOtp(email);

    const requested = await post("/auth/otp/request", { email });
    expect(requested.status).toBe(200);
    const requestBody = await requested.json();
    expect(requestBody).toEqual({ ok: true });
    expect(JSON.stringify(requestBody)).not.toMatch(/"code"/);

    const code = captured.get();
    expect(code).toMatch(/^\d{6}$/);

    const verified = await post("/auth/otp/verify", { email, code });
    expect(verified.status).toBe(200);
    const user = (await verified.json()) as { id: string; email: string };
    expect(user.email).toBe(email);
    expect(user).not.toHaveProperty("code");
    const cookie = sessionCookie(verified);

    const me = await SELF.fetch(`${base}/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual(user);

    const row = await env.DB.prepare("SELECT password_hash FROM users WHERE email = ?")
      .bind(email)
      .first<{ password_hash: string }>();
    expect(row?.password_hash.startsWith("!otp:")).toBe(true);
  });

  it("always returns ok on request without leaking existence", async () => {
    const email = `otp-leak-${crypto.randomUUID()}@example.com`;
    const captured = captureDevOtp(email);
    const res = await post("/auth/otp/request", { email: ` ${email.toUpperCase()} ` });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(captured.get()).toMatch(/^\d{6}$/);
  });

  it("rejects a wrong code and locks after 5 attempts", async () => {
    const email = `otp-lock-${crypto.randomUUID()}@example.com`;
    const captured = captureDevOtp(email);
    await post("/auth/otp/request", { email });
    const code = captured.get();
    expect(code).toBeTruthy();

    for (let i = 0; i < 5; i++) {
      const wrong = await post("/auth/otp/verify", { email, code: "000000" === code ? "111111" : "000000" });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ error: "invalid_otp" });
    }

    const afterLock = await post("/auth/otp/verify", { email, code });
    expect(afterLock.status).toBe(401);
    expect(await afterLock.json()).toEqual({ error: "invalid_otp" });
  });

  it("rate-limits OTP sends but still returns ok", async () => {
    const email = `otp-rl-${crypto.randomUUID()}@example.com`;
    const logs: string[] = [];
    const original = console.log;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.includes('"otp_dev"') && first.includes(email)) {
        logs.push(first);
        return;
      }
      original.apply(console, args as Parameters<typeof console.log>);
    });

    for (let i = 0; i < 5; i++) {
      const res = await post("/auth/otp/request", { email });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(logs.length).toBe(5);

    const sixth = await post("/auth/otp/request", { email });
    expect(sixth.status).toBe(200);
    expect(await sixth.json()).toEqual({ ok: true });
    expect(logs.length).toBe(5);
  });

  it("rejects malformed verify payloads", async () => {
    const bad = await post("/auth/otp/verify", { email: "not-an-email", code: "123456" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_input" });

    const short = await post("/auth/otp/verify", {
      email: `otp-bad-${crypto.randomUUID()}@example.com`,
      code: "12345",
    });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: "invalid_input" });
  });

  it("lets an existing password user sign in via OTP", async () => {
    const email = `otp-exist-${crypto.randomUUID()}@example.com`;
    const password = "password123";
    const registered = await post("/auth/register", { email, password });
    expect(registered.status).toBe(201);
    const created = (await registered.json()) as { id: string; email: string };

    const captured = captureDevOtp(email);
    await post("/auth/otp/request", { email });
    const code = captured.get();
    expect(code).toMatch(/^\d{6}$/);

    const verified = await post("/auth/otp/verify", { email, code });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual(created);
    sessionCookie(verified);
  });
});
