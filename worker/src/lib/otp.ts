const encoder = new TextEncoder();

const OTP_TTL_SECONDS = 10 * 60;
const RATE_LIMIT_TTL_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 5;

export type OtpRecord = {
  codeHash: string;
  attempts: number;
  expiresAt: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

function otpKey(email: string): string {
  return `otp:email:${email}`;
}

function rateLimitKey(email: string): string {
  return `otp:rl:${email}`;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cryptographically random 6-digit code, zero-padded. */
export function generateOtpCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function hashOtpCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(code));
  return toHex(digest);
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function verifyOtpCode(code: string, codeHash: string): Promise<boolean> {
  const presented = await hashOtpCode(code);
  return timingSafeEqualHex(presented, codeHash);
}

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Returns false when the email is over the send rate limit (max 5 / 15 min). */
export async function checkAndIncrementOtpSendRate(kv: KVNamespace, email: string): Promise<boolean> {
  const key = rateLimitKey(email);
  const now = Date.now();
  const existing = await readJson<RateLimitRecord>(kv, key);
  if (existing && existing.resetAt > now) {
    if (existing.count >= MAX_SENDS) return false;
    const next: RateLimitRecord = { count: existing.count + 1, resetAt: existing.resetAt };
    const ttl = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    await kv.put(key, JSON.stringify(next), { expirationTtl: ttl });
    return true;
  }
  const resetAt = now + RATE_LIMIT_TTL_SECONDS * 1000;
  await kv.put(key, JSON.stringify({ count: 1, resetAt } satisfies RateLimitRecord), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });
  return true;
}

/** Store a new OTP for the email. Overwrites any prior code. */
export async function storeOtp(kv: KVNamespace, email: string, code: string): Promise<void> {
  const codeHash = await hashOtpCode(code);
  const record: OtpRecord = {
    codeHash,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
  };
  await kv.put(otpKey(email), JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });
}

export type OtpVerifyResult = "ok" | "invalid" | "expired" | "locked";

/**
 * Verify a presented code. Increments attempts on failure.
 * Deletes the OTP record on success or when locked out.
 */
export async function consumeOtp(
  kv: KVNamespace,
  email: string,
  code: string
): Promise<OtpVerifyResult> {
  const key = otpKey(email);
  const record = await readJson<OtpRecord>(kv, key);
  if (!record) return "invalid";

  if (record.expiresAt <= Date.now()) {
    await kv.delete(key);
    return "expired";
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await kv.delete(key);
    return "locked";
  }

  if (await verifyOtpCode(code, record.codeHash)) {
    await kv.delete(key);
    return "ok";
  }

  const attempts = record.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await kv.delete(key);
    return "locked";
  }

  const remainingTtl = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000));
  await kv.put(
    key,
    JSON.stringify({ ...record, attempts } satisfies OtpRecord),
    { expirationTtl: remainingTtl }
  );
  return "invalid";
}
