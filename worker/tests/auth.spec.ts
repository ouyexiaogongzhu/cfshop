import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

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

async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function register(email: string, password = "password123"): Promise<Response> {
  return post("/auth/register", { email, password });
}

describe("POST /api/store/auth/register", () => {
  it("stores the email lowercase and returns the user", async () => {
    const email = `User.${crypto.randomUUID()}@Example.COM`;
    const res = await register(email, "12345678");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; email: string };
    expect(body.id).toEqual(expect.any(String));
    expect(body.email).toBe(email.toLowerCase());
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("password_hash");
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const res = await register(`short-${crypto.randomUUID()}@example.com`, "1234567");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
  });

  it("rejects a duplicate email", async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    const first = await register(email);
    expect(first.status).toBe(201);
    const second = await register(` ${email.toUpperCase()} `);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "email_taken" });
  });
});

describe("session", () => {
  it("logs in, reads the current user, and logs out", async () => {
    const email = `session-${crypto.randomUUID()}@example.com`;
    const password = "password123";
    const created = (await (await register(email, password)).json()) as { id: string; email: string };

    const bad = await post("/auth/login", { email, password: "wrong-password" });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "invalid_credentials" });

    const unknown = await post("/auth/login", {
      email: `missing-${crypto.randomUUID()}@example.com`,
      password,
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "invalid_credentials" });

    const loggedIn = await post("/auth/login", { email: email.toUpperCase(), password });
    expect(loggedIn.status).toBe(200);
    expect(await loggedIn.json()).toEqual(created);
    const cookie = sessionCookie(loggedIn);

    const anon = await SELF.fetch(`${base}/auth/me`);
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "unauthorized" });

    const me = await SELF.fetch(`${base}/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual(created);

    const loggedOut = await SELF.fetch(`${base}/auth/logout`, { method: "POST", headers: { cookie } });
    expect(loggedOut.status).toBe(200);
    expect(await loggedOut.json()).toEqual({ ok: true });

    const after = await SELF.fetch(`${base}/auth/me`, { headers: { cookie } });
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "unauthorized" });
  });
});

describe("addresses", () => {
  it("requires a session", async () => {
    const list = await SELF.fetch(`${base}/addresses`);
    expect(list.status).toBe(401);
    expect(await list.json()).toEqual({ error: "unauthorized" });

    const created = await post("/addresses", {
      name: "Ada",
      line1: "1 Road",
      city: "Hong Kong",
      country: "HK",
    });
    expect(created.status).toBe(401);

    const removed = await SELF.fetch(`${base}/addresses/${crypto.randomUUID()}`, { method: "DELETE" });
    expect(removed.status).toBe(401);
  });

  it("creates, lists, and deletes only the signed-in user's addresses", async () => {
    const ownerEmail = `owner-${crypto.randomUUID()}@example.com`;
    const otherEmail = `other-${crypto.randomUUID()}@example.com`;
    await register(ownerEmail);
    await register(otherEmail);
    const owner = sessionCookie(await post("/auth/login", { email: ownerEmail, password: "password123" }));
    const other = sessionCookie(await post("/auth/login", { email: otherEmail, password: "password123" }));

    const empty = await SELF.fetch(`${base}/addresses`, { headers: { cookie: owner } });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    const created = await post(
      "/addresses",
      { name: "Ada Lovelace", line1: "1 Road", city: "Hong Kong", country: "hk" },
      owner
    );
    expect(created.status).toBe(201);
    const address = (await created.json()) as { id: string; country: string };
    expect(address).toEqual({
      id: expect.any(String),
      name: "Ada Lovelace",
      line1: "1 Road",
      line2: "",
      city: "Hong Kong",
      region: "",
      postalCode: "",
      country: "HK",
    });

    const withOptional = await post(
      "/addresses",
      {
        name: "Grace Hopper",
        line1: "2 Street",
        line2: "Apt 4",
        city: "New York",
        region: "NY",
        postalCode: "10001",
        country: "us",
      },
      owner
    );
    expect(withOptional.status).toBe(201);
    const second = await withOptional.json();

    const list = await SELF.fetch(`${base}/addresses`, { headers: { cookie: owner } });
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([address, second]);

    const otherList = await SELF.fetch(`${base}/addresses`, { headers: { cookie: other } });
    expect(otherList.status).toBe(200);
    expect(await otherList.json()).toEqual([]);

    const stolen = await SELF.fetch(`${base}/addresses/${address.id}`, {
      method: "DELETE",
      headers: { cookie: other },
    });
    expect(stolen.status).toBe(404);
    expect(await stolen.json()).toEqual({ error: "not_found" });

    const missing = await SELF.fetch(`${base}/addresses/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { cookie: owner },
    });
    expect(missing.status).toBe(404);

    const removed = await SELF.fetch(`${base}/addresses/${address.id}`, {
      method: "DELETE",
      headers: { cookie: owner },
    });
    expect(removed.status).toBe(204);
    expect(await removed.text()).toBe("");

    const remaining = await SELF.fetch(`${base}/addresses`, { headers: { cookie: owner } });
    expect(await remaining.json()).toEqual([second]);
  });

  it("rejects a country that is not ISO-3166 alpha-2", async () => {
    const email = `country-${crypto.randomUUID()}@example.com`;
    await register(email);
    const cookie = sessionCookie(await post("/auth/login", { email, password: "password123" }));
    const res = await post(
      "/addresses",
      { name: "Ada", line1: "1 Road", city: "Hong Kong", country: "HKG" },
      cookie
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
  });
});
