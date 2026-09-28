declare global {
  interface Env {
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    /** When `production`, mock payments are disabled (fail-closed without Stripe). */
    ENVIRONMENT?: string;
  }
}

export type PaymentSessionRequest = {
  orderId: string;
  amount: number;
  currency: string;
  customerEmail: string;
};

export type PaymentSession = {
  provider: "mock" | "stripe";
  sessionId: string;
  url: string;
};

export type VerifiedWebhook = {
  provider: "stripe";
  eventId: string;
  type: string;
  orderId: string | null;
};

export interface PaymentProvider {
  readonly name: "mock" | "stripe";
  createCheckoutSession(input: PaymentSessionRequest): Promise<PaymentSession>;
  verifyWebhookSignature(payload: string, signatureHeader: string | null): Promise<VerifiedWebhook>;
}

export class PaymentUnavailableError extends Error {
  status = 503;
  constructor(message = "payment_unavailable") {
    super(message);
    this.name = "PaymentUnavailableError";
  }
}

export class WebhookVerificationError extends Error {
  status = 400;
  constructor(message = "invalid_signature") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

/** Local and test checkout only. Never selected when ENVIRONMENT=production. */
class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createCheckoutSession(input: PaymentSessionRequest): Promise<PaymentSession> {
    const sessionId = `mock_${input.orderId}`;
    return {
      provider: "mock",
      sessionId,
      url: `https://mock-pay.example/checkout?session=${sessionId}&order=${input.orderId}`,
    };
  }

  async verifyWebhookSignature(): Promise<VerifiedWebhook> {
    throw new WebhookVerificationError("mock_provider_has_no_webhooks");
  }
}

/**
 * Stripe adapter skeleton. Does not call the Stripe HTTP API and never sees card numbers.
 * `createCheckoutSession` fails closed when the secret key is missing.
 */
class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe" as const;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string | undefined
  ) {
    if (!secretKey) throw new PaymentUnavailableError("stripe_not_configured");
  }

  async createCheckoutSession(input: PaymentSessionRequest): Promise<PaymentSession> {
    // Real Stripe Checkout Session create is not wired yet — fail closed so
    // misconfigured deploys cannot hand customers fabricated cs_test_* URLs.
    void input;
    throw new PaymentUnavailableError("stripe_checkout_not_implemented");
  }

  async verifyWebhookSignature(
    payload: string,
    signatureHeader: string | null
  ): Promise<VerifiedWebhook> {
    if (!this.webhookSecret) throw new PaymentUnavailableError("stripe_webhook_not_configured");
    if (!signatureHeader) throw new WebhookVerificationError();

    const parts = Object.fromEntries(
      signatureHeader.split(",").map((piece) => {
        const eq = piece.indexOf("=");
        if (eq <= 0) return ["", ""];
        return [piece.slice(0, eq).trim(), piece.slice(eq + 1).trim()];
      })
    );
    const timestamp = parts["t"];
    const v1 = parts["v1"];
    if (!timestamp || !v1) throw new WebhookVerificationError();

    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
    const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!timingSafeEqualHex(expected, v1)) throw new WebhookVerificationError();

    let parsed: {
      id?: unknown;
      type?: unknown;
      data?: { object?: { metadata?: { order_id?: unknown } } };
    };
    try {
      parsed = JSON.parse(payload) as typeof parsed;
    } catch {
      throw new WebhookVerificationError("invalid_payload");
    }

    const orderId = parsed.data?.object?.metadata?.order_id;
    return {
      provider: "stripe",
      eventId: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : "unknown",
      type: typeof parsed.type === "string" && parsed.type.length > 0 ? parsed.type : "unknown",
      orderId: typeof orderId === "string" ? orderId : null,
    };
  }
}

function timingSafeEqualHex(expected: string, presented: string): boolean {
  const a = expected.toLowerCase();
  const b = presented.toLowerCase();
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function resolvePaymentProvider(env: Env): PaymentProvider {
  const environment = (env.ENVIRONMENT ?? "development").trim().toLowerCase();
  const stripeKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();

  if (environment === "production") {
    if (!stripeKey) throw new PaymentUnavailableError("stripe_required_in_production");
    return new StripePaymentProvider(stripeKey, webhookSecret);
  }

  if (stripeKey) return new StripePaymentProvider(stripeKey, webhookSecret);
  return new MockPaymentProvider();
}

/** Stripe webhook HMAC check, independent of which checkout session provider is active. */
export function resolveStripeWebhookVerifier(env: Env): PaymentProvider {
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) throw new PaymentUnavailableError("stripe_webhook_not_configured");
  const environment = (env.ENVIRONMENT ?? "development").trim().toLowerCase();
  const stripeKey = env.STRIPE_SECRET_KEY?.trim() ?? "";
  if (environment === "production" && !stripeKey) {
    throw new PaymentUnavailableError("stripe_required_in_production");
  }
  return new StripePaymentProvider(stripeKey || "sk_test_unconfigured", webhookSecret);
}
