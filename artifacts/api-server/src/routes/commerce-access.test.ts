import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  collectAllPages,
  hasPackageAccess,
  INSTRUMENT_IDS,
  isActiveStudioSubscription,
  resolveCommerceAccess,
} from "./commerce-access.ts";

const now = 2_000_000_000_000;
const futurePeriodEnd = now + 30 * 24 * 60 * 60 * 1000;
const expiredPeriodEnd = now - 1000;

function paymentSession(entitlement: string, paymentStatus: Stripe.Checkout.Session.PaymentStatus = "paid") {
  return {
    mode: "payment",
    payment_status: paymentStatus,
    metadata: { entitlement },
  } as unknown as Stripe.Checkout.Session;
}

function studioSubscription(
  id: string,
  status: Stripe.Subscription.Status = "active",
  currentPeriodEnd = futurePeriodEnd,
  cancelAtPeriodEnd = false,
) {
  return {
    id,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      data: [{
        current_period_end: Math.floor(currentPeriodEnd / 1_000),
        price: { metadata: { entitlement: "studio" } },
      }],
    },
  } as unknown as Stripe.Subscription;
}

async function* pages<T>(entries: T[], pageSize = 100) {
  for (let offset = 0; offset < entries.length; offset += pageSize) {
    yield* entries.slice(offset, offset + pageSize);
  }
}

test("paid Stripe test-mode sessions grant the matching package entitlements", () => {
  const access = resolveCommerceAccess([
    studioSubscription("sub-monthly"),
  ], [
    paymentSession("instrument:acoustic-guitar"),
    paymentSession("instrument:all"),
    paymentSession("commercial-sdk:all"),
  ], now);

  assert.deepEqual(access.entitlements.instruments, [...INSTRUMENT_IDS]);
  assert.deepEqual(access.entitlements.sdks, [...INSTRUMENT_IDS]);
  assert.equal(access.entitlements.commercialSdk, true);
});

test("personal and commercial package licenses cannot be substituted", () => {
  const personalAccess = resolveCommerceAccess([], [
    paymentSession("instrument:acoustic-guitar"),
  ], now);
  const commercialAccess = resolveCommerceAccess([], [
    paymentSession("commercial-sdk:all"),
  ], now);

  assert.equal(hasPackageAccess(personalAccess, "acoustic-guitar", "personal"), true);
  assert.equal(hasPackageAccess(personalAccess, "acoustic-guitar", "commercial"), false);
  assert.equal(hasPackageAccess(personalAccess, "bass-guitar", "personal"), false);
  assert.equal(hasPackageAccess(commercialAccess, "acoustic-guitar", "commercial"), true);
  assert.equal(hasPackageAccess(commercialAccess, "acoustic-guitar", "personal"), false);
  assert.equal(hasPackageAccess(commercialAccess, "acoustic-guitar", undefined), false);
  assert.equal(hasPackageAccess(commercialAccess, "acoustic-guitar", "enterprise"), false);
});

test("monthly and annual Studio test-mode subscriptions grant generation access", () => {
  const monthly = studioSubscription("sub-monthly");
  const annual = studioSubscription("sub-annual", "active", futurePeriodEnd + 365 * 24 * 60 * 60 * 1000);

  assert.equal(isActiveStudioSubscription(monthly, now), true);
  assert.equal(resolveCommerceAccess([monthly], [], now).studioActive, true);
  assert.equal(isActiveStudioSubscription(annual, now), true);
  assert.equal(resolveCommerceAccess([annual], [], now).studioActive, true);
  assert.equal(resolveCommerceAccess([], [], now).studioActive, false);
});

test("cancellation at period end retains Studio access until expiry", () => {
  const endingSoon = studioSubscription("sub-ending", "active", futurePeriodEnd, true);
  const ended = studioSubscription("sub-ended", "active", expiredPeriodEnd, true);

  assert.equal(isActiveStudioSubscription(endingSoon, now), true);
  assert.equal(resolveCommerceAccess([endingSoon], [], now).studioActive, true);
  assert.equal(isActiveStudioSubscription(ended, now), false);
  assert.equal(resolveCommerceAccess([ended], [], now).studioActive, false);
});

test("unpaid or non-payment Stripe sessions do not grant one-time access", () => {
  const access = resolveCommerceAccess([], [
    paymentSession("instrument:acoustic-guitar", "unpaid"),
    { ...paymentSession("instrument:all"), mode: "subscription" } as unknown as Stripe.Checkout.Session,
  ], now);

  assert.deepEqual(access.entitlements.instruments, []);
  assert.equal(access.entitlements.commercialSdk, false);
});

test("a permanent paid entitlement remains available past Stripe's first result page", async () => {
  const sessions = [
    ...Array.from({ length: 100 }, () => paymentSession("instrument:unrecognized")),
    paymentSession("commercial-sdk:all"),
  ];
  const access = resolveCommerceAccess([], await collectAllPages(pages(sessions)), now);

  assert.equal(access.entitlements.commercialSdk, true);
});