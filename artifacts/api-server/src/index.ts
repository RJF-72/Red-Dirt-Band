import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./stripeClient";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for Stripe integration.");
  await runMigrations({ databaseUrl });
  const sync = await getStripeSync();
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) {
    await sync.findOrCreateManagedWebhook(`https://${domain}/api/stripe/webhook`);
  } else {
    logger.warn("REPLIT_DOMAINS is not set; managed Stripe webhook setup was skipped.");
  }
  await sync.syncBackfill();
  logger.info("Stripe schema and catalog synchronized");
}

try {
  await initStripe();
} catch (error) {
  logger.error(
    { err: error },
    "Stripe billing initialization failed. Owner access and Studio remain available.",
  );
}
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
