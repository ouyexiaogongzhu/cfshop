import { Hono } from "hono";
import type { Context } from "hono";
import {
  checkAndIncrementOtpSendRate,
  consumeOtp,
  generateOtpCode,
  storeOtp,
} from "../../lib/otp";
import { hashPassword, verifyPassword } from "../../lib/password";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionUserId,
  sessionCookie,
  setSessionCookie,
} from "../../lib/session";

export const authRoutes = new Hono<{ Bindings: Env }>();

type UserPublic = { id: string; email: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(c: Context<{ Bindings: Env }>): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return c.json({ error: "invalid_input" }, 400);
  }
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function isProduction(env: Env): boolean {
  return (env.ENVIRONMENT ?? "development").trim().toLowerCase() === "production";
}

/** Marker that cannot verify via password login (PBKDF2 format requires salt.hash). */
function unusablePasswordHash(): string {
  return `!otp:${crypto.randomUUID()}`;
}

authRoutes.post("/auth/register", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return c.json({ error: "invalid_input" }, 400);

  const email = normalizeEmail(body.email);
  const password = body.password;
  if (!email || typeof password !== "string" || password.length < 8) {
    return c.json({ error: "invalid_input" }, 400);
  }

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const inserted = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)"
  )
    .bind(id, email, passwordHash)
    .run();
  if (inserted.meta.changes === 0) return c.json({ error: "email_taken" }, 409);

  const user: UserPublic = { id, email };
  return c.json(user, 201);
});

authRoutes.post("/auth/login", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  if (!isRecord(body) || typeof body.email !== "string" || typeof body.password !== "string") {
    return c.json({ error: "invalid_input" }, 400);
  }

  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const user = email
    ? await c.env.DB.prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
        .bind(email)
        .first<{ id: string; email: string; password_hash: string }>()
    : null;

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: "invalid_credentials" }, 401);
  }

  const sessionId = await createSession(c.env.CACHE, user.id);
  setSessionCookie(c, sessionId);
  return c.json({ id: user.id, email: user.email } satisfies UserPublic);
});

authRoutes.post("/auth/logout", async (c) => {
  await destroySession(c.env.CACHE, sessionCookie(c));
  clearSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get("/auth/me", async (c) => {
  const userId = await readSessionUserId(c.env.CACHE, sessionCookie(c));
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const user = await c.env.DB.prepare("SELECT id, email FROM users WHERE id = ?")
    .bind(userId)
    .first<UserPublic>();
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(user);
});

authRoutes.post("/auth/otp/request", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return c.json({ error: "invalid_input" }, 400);

  const email = normalizeEmail(body.email);
  // Always succeed externally so callers cannot probe whether an email exists.
  if (!email) return c.json({ ok: true });

  const allowed = await checkAndIncrementOtpSendRate(c.env.CACHE, email);
  if (!allowed) return c.json({ ok: true });

  let user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (!user) {
    const id = crypto.randomUUID();
    const inserted = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)"
    )
      .bind(id, email, unusablePasswordHash())
      .run();
    if (inserted.meta.changes === 0) {
      user = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
        .bind(email)
        .first<{ id: string }>();
    } else {
      user = { id };
    }
  }

  if (!user) return c.json({ ok: true });

  const code = generateOtpCode();
  await storeOtp(c.env.CACHE, email, code);

  if (!isProduction(c.env)) {
    console.log(JSON.stringify({ msg: "otp_dev", email, code }));
  }

  return c.json({ ok: true });
});

authRoutes.post("/auth/otp/verify", async (c) => {
  const body = await readJson(c);
  if (body instanceof Response) return body;
  if (!isRecord(body)) return c.json({ error: "invalid_input" }, 400);

  const email = normalizeEmail(body.email);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    return c.json({ error: "invalid_input" }, 400);
  }

  const result = await consumeOtp(c.env.CACHE, email, code);
  if (result !== "ok") {
    return c.json({ error: "invalid_otp" }, 401);
  }

  const user = await c.env.DB.prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(email)
    .first<UserPublic>();
  if (!user) return c.json({ error: "invalid_otp" }, 401);

  const sessionId = await createSession(c.env.CACHE, user.id);
  setSessionCookie(c, sessionId);
  return c.json({ id: user.id, email: user.email } satisfies UserPublic);
});
