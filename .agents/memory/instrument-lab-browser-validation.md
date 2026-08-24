---
name: Instrument Lab browser validation
description: Runtime requirements and scope for browser-level Instrument Lab release checks
---

The Instrument Lab browser gate should exercise the running Replit preview rather than Vite's localhost server or a production build served from a different origin. The preview origin is required for `/api` artifact routing. Its headless Chromium runtime depends on the graphics/audio libraries declared in the workspace Nix configuration, and host requirement validation is skipped because the libraries are supplied by Replit's environment.

**Why:** Unit tests cannot observe Web Audio API compatibility or whether the user receives a downloadable WAV.

**How to apply:** The gate establishes a short-lived real Clerk owner session and copies only its browser cookies into an isolated preview context; do not add a development or production access-control bypass for tests. Keep the browser gate focused on the Generate action, the visible WAV download, and a user-visible recovery state when OfflineAudioContext is unavailable.