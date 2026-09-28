import type { Context, Next } from "hono";

/** Bearer token compared as SHA-256 digests so length does not short-circuit. */
export async function requireAdmin(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const expected = c.env.ADMIN_TOKEN;
  const header = c.req.header("Authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!expected || !(await digestEqual(presented, expected))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}

async function digestEqual(a: string, b: string): Promise<boolean> {
  const encode = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode.encode(a)),
    crypto.subtle.digest("SHA-256", encode.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}
