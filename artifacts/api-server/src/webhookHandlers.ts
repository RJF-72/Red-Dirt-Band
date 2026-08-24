import { getStripeSync } from "./stripeClient";

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error("Stripe webhook payload must be a raw Buffer.");
    }
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
  }
}