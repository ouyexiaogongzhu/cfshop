import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";

const COOKIE = "cfshop_session";
const TTL_SECONDS = 60 * 60 * 24 * 30;

export async function createSession(kv: KVNamespace, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await kv.put(`session:${id}`, userId, { expirationTtl: TTL_SECONDS });
  return id;
}

export async function readSessionUserId(kv: KVNamespace, sessionId: string | undefined): Promise<string | null> {
  if (!sessionId) return null;
  return kv.get(`session:${sessionId}`);
}

export async function destroySession(kv: KVNamespace, sessionId: string | undefined): Promise<void> {
  if (sessionId) await kv.delete(`session:${sessionId}`);
}

export function sessionCookie(c: Context): string | undefined {
  return getCookie(c, COOKIE);
}

export function setSessionCookie(c: Context, sessionId: string): void {
  setCookie(c, COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}
