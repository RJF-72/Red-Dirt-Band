import Stripe from "stripe";

export const INSTRUMENT_IDS = [
  "acoustic-guitar",
  "bass-guitar",
  "electric-guitar",
  "pedal-steel",
  "fiddle",
  "keyboard",
  "vocal",
] as const;

export type InstrumentId = typeof INSTRUMENT_IDS[number];
export type PackageLicense = "personal" | "commercial";

export type CommerceAccess = {
  studioActive: boolean;
  entitlements: {
    instruments: InstrumentId[];
    sdks: InstrumentId[];
    commercialSdk: boolean;
  };
  subscription: {
    id: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: number;
  } | null;
};

export async function collectAllPages<T>(entries: AsyncIterable<T>) {
  const collected: T[] = [];
  for await (const entry of entries) collected.push(entry);
  return collected;
}

export function emptyCommerceAccess(): CommerceAccess {
  return {
    studioActive: false,
    entitlements: { instruments: [], sdks: [], commercialSdk: false },
    subscription: null,
  };
}

export function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  return Math.max(...subscription.items.data.map((item) => item.current_period_end), 0) * 1000;
}

export function isActiveStudioSubscription(subscription: Stripe.Subscription, now = Date.now()) {
  if (subscription.status !== "active" && subscription.status !== "trialing") return false;
  const periodEnd = subscriptionPeriodEnd(subscription);
  return periodEnd === 0 || periodEnd > now;
}

export function resolveCommerceAccess(
  subscriptions: Stripe.Subscription[],
  sessions: Stripe.Checkout.Session[],
  now = Date.now(),
): CommerceAccess {
  const studioSubscription = subscriptions
    .filter((subscription) => isActiveStudioSubscription(subscription, now))
    .find((subscription) => subscription.items.data.some((item) => item.price.metadata?.entitlement === "studio"))
    ?? null;
  const instruments = new Set<InstrumentId>();
  const sdks = new Set<InstrumentId>();
  let commercialSdk = false;

  for (const session of sessions) {
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

export function hasPackageAccess(
  access: CommerceAccess,
  instrumentId: InstrumentId,
  license: unknown,
) {
  if (license !== "personal" && license !== "commercial") return false;
  return license === "commercial"
    ? access.entitlements.commercialSdk
    : access.entitlements.instruments.includes(instrumentId);
}