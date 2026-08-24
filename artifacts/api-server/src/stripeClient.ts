import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const configuredSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (configuredSecretKey) {
    if (!configuredSecretKey.startsWith("sk_") && !configuredSecretKey.startsWith("rk_")) {
      throw new Error("STRIPE_SECRET_KEY must be a Stripe server key beginning with sk_ or rk_.");
    }
    return {
      secretKey: configuredSecretKey,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error("Stripe integration is not available in this environment.");
  }

  const response = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`Unable to load Stripe connection (${response.status}).`);
  const body = await response.json() as { items?: Array<{ settings?: { secret_key?: string; webhook_secret?: string } }> };
  const settings = body.items?.[0]?.settings;
  if (!settings?.secret_key) throw new Error("Stripe is connected but has no secret key.");
  return { secretKey: settings.secret_key, webhookSecret: settings.webhook_secret };
}

export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe synchronization.");
  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret ?? "",
  });
}