import Stripe from "stripe";
import { getUncachableStripeClient } from "./stripeClient";

const instruments = [
  ["acoustic-guitar", "Acoustic Guitar"],
  ["bass-guitar", "Bass Guitar"],
  ["electric-guitar", "Electric Guitar"],
  ["pedal-steel", "Pedal Steel Guitar"],
  ["fiddle", "Fiddle"],
  ["keyboard", "Keyboard"],
  ["vocal", "Vocal"],
] as const;

async function findOrCreateProduct(stripe: Stripe, input: Stripe.ProductCreateParams) {
  const products = await stripe.products.list({ active: true, limit: 100 });
  const existing = products.data.find((product) => product.metadata.entitlement === input.metadata?.entitlement);
  return existing ?? stripe.products.create(input);
}

async function findOrCreatePrice(stripe: Stripe, product: Stripe.Product, input: Stripe.PriceCreateParams) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const recurringInterval = input.recurring?.interval ?? null;
  const existing = prices.data.find((price) =>
    price.unit_amount === input.unit_amount
    && price.currency === input.currency
    && (price.recurring?.interval ?? null) === recurringInterval,
  );
  return existing ?? stripe.prices.create(input);
}

async function seed() {
  const stripe = await getUncachableStripeClient();
  const created: Array<{ name: string; priceId: string }> = [];

  for (const [instrumentId, title] of instruments) {
    const product = await findOrCreateProduct(stripe, {
      name: `${title} AIM + Personal SDK`,
      description: `A procedural ${title.toLowerCase()} instrument package with the matching personal-use SDK.`,
      metadata: { commerce_type: "instrument", entitlement: `instrument:${instrumentId}`, instrument_id: instrumentId },
    });
    const price = await findOrCreatePrice(stripe, product, {
      product: product.id, unit_amount: 3900, currency: "usd",
      metadata: { entitlement: `instrument:${instrumentId}` },
    });
    created.push({ name: product.name, priceId: price.id });
  }

  const library = await findOrCreateProduct(stripe, {
    name: "AIM Complete Instrument Library + Personal SDK",
    description: "All seven procedural AIM instruments with their matching personal-use SDKs.",
    metadata: { commerce_type: "instrument", entitlement: "instrument:all" },
  });
  const libraryPrice = await findOrCreatePrice(stripe, library, {
    product: library.id, unit_amount: 17900, currency: "usd", metadata: { entitlement: "instrument:all" },
  });
  created.push({ name: library.name, priceId: libraryPrice.id });

  const commercial = await findOrCreateProduct(stripe, {
    name: "AIM Commercial All-Instrument SDK",
    description: "Commercial license for all seven AIM instrument runtimes and SDK contracts.",
    metadata: { commerce_type: "commercial-sdk", entitlement: "commercial-sdk:all" },
  });
  const commercialPrice = await findOrCreatePrice(stripe, commercial, {
    product: commercial.id, unit_amount: 49900, currency: "usd", metadata: { entitlement: "commercial-sdk:all" },
  });
  created.push({ name: commercial.name, priceId: commercialPrice.id });

  const studio = await findOrCreateProduct(stripe, {
    name: "AIM Music Studio",
    description: "Subscriber access to procedural song generation, arrangements, stems, and lyric timing.",
    metadata: { commerce_type: "studio", entitlement: "studio" },
  });
  const monthly = await findOrCreatePrice(stripe, studio, {
    product: studio.id, unit_amount: 2900, currency: "usd", recurring: { interval: "month" }, metadata: { entitlement: "studio" },
  });
  const annual = await findOrCreatePrice(stripe, studio, {
    product: studio.id, unit_amount: 24900, currency: "usd", recurring: { interval: "year" }, metadata: { entitlement: "studio" },
  });
  created.push({ name: `${studio.name} monthly`, priceId: monthly.id }, { name: `${studio.name} annual`, priceId: annual.id });

  for (const item of created) console.log(`${item.name}: ${item.priceId}`);
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});