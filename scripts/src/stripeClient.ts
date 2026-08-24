import Stripe from "stripe";

async function getStripeSecretKey() {
  const configuredSecretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (configuredSecretKey) {
    if (!configuredSecretKey.startsWith("sk_") && !configuredSecretKey.startsWith("rk_")) {
      throw new Error("STRIPE_SECRET_KEY must be a Stripe server key beginning with sk_ or rk_.");
    }
    return configuredSecretKey;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? `repl ${process.env.REPL_IDENTITY}`
    : process.env.WEB_REPL_RENEWAL
      ? `depl ${process.env.WEB_REPL_RENEWAL}`
      : null;
  if (!hostname || !xReplitToken) throw new Error("Stripe integration is not available in this environment.");
  const response = await fetch(`https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`, {
    headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
  });
  if (!response.ok) throw new Error(`Unable to load Stripe connection (${response.status}).`);
  const body = await response.json() as { items?: Array<{ settings?: { secret_key?: string } }> };
  const secretKey = body.items?.[0]?.settings?.secret_key;
  if (!secretKey) throw new Error("Stripe is connected but has no secret key.");
  return secretKey;
}

export async function getUncachableStripeClient() {
  return new Stripe(await getStripeSecretKey());
}