import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { Router, type Request } from "express";
import Stripe from "stripe";
import { commerceAccountsTable, db } from "@workspace/db";
import { isOwner } from "./owner";
import { getUncachableStripeClient } from "../stripeClient";

const router = Router();
const INSTRUMENT_IDS = [
  "acoustic-guitar",
  "bass-guitar",
  "electric-guitar",
  "pedal-steel",
  "fiddle",
  "keyboard",
  "vocal",
] as const;
type InstrumentId = typeof INSTRUMENT_IDS[number];
type ProductKind = "instrument" | "commercial-sdk" | "studio";

function currentUserId(req: Request) {
  return getAuth(req).userId;
}

function productKind(product: Stripe.Product): ProductKind | null {
  const value = product.metadata?.commerce_type;
  return value === "instrument" || value === "commercial-sdk" || value === "studio" ? value : null;
}

function publicOrigin(req: Request) {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  return domain ? `https://${domain}` : `${req.protocol}://${req.get("host")}`;
}

function productSummary(product: Stripe.Product, prices: Stripe.Price[]) {
  const kind = productKind(product);
  if (!kind) return null;
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    kind,
    entitlement: product.metadata.entitlement ?? null,
    instrumentId: product.metadata.instrument_id ?? null,
    prices: prices.map((price) => ({
      id: price.id,
      amount: price.unit_amount,
      currency: price.currency,
      interval: price.recurring?.interval ?? null,
      intervalCount: price.recurring?.interval_count ?? null,
    })),
  };
}

async function ensureStripeCustomer(userId: string) {
  const [account] = await db.select().from(commerceAccountsTable).where(eq(commerceAccountsTable.userId, userId));
  if (account) return account.stripeCustomerId;

  const user = await clerkClient.users.getUser(userId);
  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
  if (!email) throw new Error("A verified email address is required for checkout.");
  const stripe = await getUncachableStripeClient();
  const customer = await stripe.customers.create({ email, metadata: { userId } });
  await db.insert(commerceAccountsTable).values({ userId, stripeCustomerId: customer.id }).onConflictDoNothing();
  const [created] = await db.select().from(commerceAccountsTable).where(eq(commerceAccountsTable.userId, userId));
  return created?.stripeCustomerId ?? customer.id;
}

async function getOwnedCustomer(userId: string) {
  const [account] = await db.select().from(commerceAccountsTable).where(eq(commerceAccountsTable.userId, userId));
  return account?.stripeCustomerId ?? null;
}

function activeSubscription(subscription: Stripe.Subscription) {
  return subscription.status === "active" || subscription.status === "trialing";
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  return Math.max(...subscription.items.data.map((item) => item.current_period_end), 0) * 1000;
}

async function accessForCustomer(customerId: string | null) {
  if (!customerId) {
    return {
      studioActive: false,
      entitlements: { instruments: [], sdks: [], commercialSdk: false },
      subscription: null,
    };
  }

  const stripe = await getUncachableStripeClient();
  const [subscriptions, sessions] = await Promise.all([
    stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 }),
    stripe.checkout.sessions.list({ customer: customerId, status: "complete", limit: 100 }),
  ]);
  const studioSubscription = subscriptions.data
    .filter(activeSubscription)
    .find((subscription) => subscription.items.data.some((item) => item.price.metadata?.entitlement === "studio"))
    ?? null;
  const instruments = new Set<InstrumentId>();
  const sdks = new Set<InstrumentId>();
  let commercialSdk = false;

  for (const session of sessions.data) {
    if (session.payment_status !== "paid" || session.mode !== "payment") continue;
    const entitlement = session.metadata?.entitlement;
    if (entitlement === "instrument:all") {
      INSTRUMENT_IDS.forEach((id) => { instruments.add(id); sdks.add(id); });
    } else if (entitlement?.startsWith("instrument:")) {
      const instrument = entitlement.slice("instrument:".length) as InstrumentId;
      if (INSTRUMENT_IDS.includes(instrument)) {
        instruments.add(instrument);
        sdks.add(instrument);
      }
    } else if (entitlement === "commercial-sdk:all") {
      commercialSdk = true;
    }
  }

  return {
    studioActive: Boolean(studioSubscription),
    entitlements: {
      instruments: [...instruments],
      sdks: [...sdks],
      commercialSdk,
    },
    subscription: studioSubscription ? {
      id: studioSubscription.id,
      status: studioSubscription.status,
      cancelAtPeriodEnd: studioSubscription.cancel_at_period_end,
      currentPeriodEnd: subscriptionPeriodEnd(studioSubscription),
    } : null,
  };
}

router.get("/commerce/catalog", async (_req, res): Promise<void> => {
  try {
    const stripe = await getUncachableStripeClient();
    const products = await stripe.products.list({ active: true, limit: 100 });
    const summaries = await Promise.all(products.data.map(async (product) => {
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 20 });
      return productSummary(product, prices.data);
    }));
    res.json({ products: summaries.filter((product): product is NonNullable<typeof product> => Boolean(product)) });
  } catch (error) {
    res.status(503).json({ error: "The storefront is temporarily unavailable." });
  }
});

router.get("/commerce/access", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    res.json(await accessForCustomer(await getOwnedCustomer(userId)));
  } catch (error) {
    req.log.error({ err: error }, "Unable to resolve commerce access");
    res.status(503).json({ error: "Your paid access could not be checked. Please try again." });
  }
});

router.post("/commerce/generation-access", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    if (await isOwner(req)) {
      res.json({ granted: true, source: "owner" });
      return;
    }
    const access = await accessForCustomer(await getOwnedCustomer(userId));
    if (!access.studioActive) {
      res.status(403).json({ error: "An active AIM Music Studio subscription is required to render songs." });
      return;
    }
    res.json({ granted: true, source: "subscription" });
  } catch (error) {
    req.log.error({ err: error }, "Unable to verify Studio generation access");
    res.status(503).json({ error: "Studio access could not be verified. Please try again." });
  }
});

router.post("/commerce/package-access/:instrumentId", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  const instrumentId = req.params.instrumentId as InstrumentId;
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!INSTRUMENT_IDS.includes(instrumentId)) {
    res.status(404).json({ error: "That instrument package does not exist." });
    return;
  }
  try {
    const access = await accessForCustomer(await getOwnedCustomer(userId));
    const license = req.body?.license;
    const granted = license === "commercial"
      ? access.entitlements.commercialSdk
      : access.entitlements.instruments.includes(instrumentId);
    if (!granted) {
      res.status(403).json({ error: "This AIM package is not included in your license." });
      return;
    }
    res.json({ granted: true, instrumentId, license: license === "commercial" ? "commercial" : "personal" });
  } catch (error) {
    req.log.error({ err: error }, "Unable to verify package download access");
    res.status(503).json({ error: "Package access could not be verified. Please try again." });
  }
});

router.post("/commerce/checkout", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const priceId = req.body?.priceId;
  if (typeof priceId !== "string" || !priceId.startsWith("price_")) {
    res.status(400).json({ error: "A valid offer is required." }); return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    if (!price.active || typeof price.product === "string" || price.product.deleted || !price.product.active) {
      res.status(400).json({ error: "That offer is no longer available." }); return;
    }
    const product = price.product;
    const kind = productKind(product);
    const entitlement = product.metadata.entitlement;
    if (!kind || !entitlement) {
      res.status(400).json({ error: "That offer is not available for purchase." }); return;
    }
    if (kind === "studio" && !price.recurring) {
      res.status(400).json({ error: "The Studio offer must be recurring." }); return;
    }
    if (kind !== "studio" && price.recurring) {
      res.status(400).json({ error: "That offer is not a one-time purchase." }); return;
    }
    const customerId = await ensureStripeCustomer(userId);
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: price.recurring ? "subscription" : "payment",
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${publicOrigin(req)}/?checkout=success`,
      cancel_url: `${publicOrigin(req)}/?checkout=cancelled`,
      metadata: { userId, entitlement, commerceType: kind, priceId: price.id },
      ...(price.recurring ? { subscription_data: { metadata: { userId, entitlement, commerceType: kind } } } : {}),
    });
    res.json({ url: session.url });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create Stripe checkout session");
    res.status(502).json({ error: "Checkout could not be started. Please try again." });
  }
});

router.post("/commerce/portal", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const customerId = await getOwnedCustomer(userId);
    if (!customerId) { res.status(400).json({ error: "No billing account exists yet." }); return; }
    const stripe = await getUncachableStripeClient();
    const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: publicOrigin(req) });
    res.json({ url: portal.url });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create Stripe customer portal session");
    res.status(502).json({ error: "Billing management could not be opened. Please try again." });
  }
});

router.post("/commerce/subscription/cancel", async (req, res): Promise<void> => {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const customerId = await getOwnedCustomer(userId);
    if (!customerId) { res.status(404).json({ error: "No Studio subscription found." }); return; }
    const stripe = await getUncachableStripeClient();
    const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    const subscription = subscriptions.data.find((item) => activeSubscription(item) && item.items.data.some((entry) => entry.price.metadata?.entitlement === "studio"));
    if (!subscription) { res.status(404).json({ error: "No active Studio subscription found." }); return; }
    const updated = await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
    res.json({
      id: updated.id,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      currentPeriodEnd: subscriptionPeriodEnd(updated),
    });
  } catch (error) {
    req.log.error({ err: error }, "Unable to cancel Studio subscription");
    res.status(502).json({ error: "The Studio subscription could not be cancelled. Please try again." });
  }
});

export default router;