---
name: Vite React cache
description: Preventing stale prebundled React versions in the Instrument Lab preview.
---

Instrument Lab must resolve React and React DOM to the same workspace package roots and force Vite dependency optimization after React catalog updates.

**Why:** Vite can retain an older root dependency prebundle even after pnpm resolves matching React packages, producing a browser-only version mismatch.

**How to apply:** Keep the Vite aliases for both packages and force optimizer refresh when changing React versions. Confirm the preview console, not only the lockfile or TypeScript check.