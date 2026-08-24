---
name: Stripe Sync migrations
description: Stripe Sync needs its packaged SQL migration files at runtime.
---

Keep Stripe Sync's packaged migration assets available at runtime.

**Why:** The library resolves SQL migrations relative to its installed package. Bundling can move the runtime module away from those assets, leaving an empty Stripe schema and causing startup synchronization failures.

**How to apply:** When changing a server bundler or upgrading Stripe Sync, preserve access to package-relative migration assets and verify startup completes Stripe schema/catalog synchronization.