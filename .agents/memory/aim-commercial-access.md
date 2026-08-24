---
name: AIM commercial access
description: Product access model for the private AIM builder, subscriber Studio, and purchasable packages.
---

The AIM instrument creation workbench is owner-only. Song Studio is the subscriber-facing product. Individual instruments and SDK access are intended as separate purchasable offerings.

**Why:** The proprietary builder and its source-layer workflow must not be exposed to customers, while customers still need paths to use the Studio and purchase compatible products.

**How to apply:** Keep creator routes behind a server-verified owner allowlist, but treat unavailable owner verification as non-owner for the customer experience; only creator mutations fail closed. Treat customer account creation as distinct from paid entitlement; do not label a flow as a subscription until checkout and entitlement enforcement are implemented.

Initial commercial pricing is $39 per instrument with its matching personal-use SDK, $179 for all seven, $29/month or $249/year for Studio, and $499 for a commercial all-instrument SDK license.

**Why:** This establishes premium-but-accessible launch pricing while making the seven-instrument bundle and annual Studio plan the clear value choices.

**How to apply:** Use these as launch prices in the future storefront and subscription implementation; do not charge separately for the basic SDK package that accompanies an instrument.