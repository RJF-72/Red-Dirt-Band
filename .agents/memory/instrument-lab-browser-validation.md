---
name: Instrument Lab browser validation
description: Runtime requirements and scope for browser-level Instrument Lab release checks
---

The Instrument Lab browser gate should exercise the running preview rather than a production build served from a different origin. Its headless Chromium runtime depends on the graphics/audio libraries declared in the workspace Nix configuration, and host requirement validation is skipped because the libraries are supplied by Replit's environment.

**Why:** Unit tests cannot observe Web Audio API compatibility or whether the user receives a downloadable WAV.

**How to apply:** Keep the browser gate focused on the Generate action, the visible WAV download, and a user-visible recovery state when OfflineAudioContext is unavailable.