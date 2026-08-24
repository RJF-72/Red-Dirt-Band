---
name: Private studio persistence
description: Durable storage and authorization rules for AIM songs, render history, packages, and source reference layers.
---

Every App Storage object used by the studio must be recorded with its Clerk user owner when its upload URL is issued. All later reads and all project, package, or reference-layer records must verify that ownership; opaque object paths are not authorization.

**Why:** An authenticated-only object proxy is insufficient because a leaked or copied object path could otherwise expose another creator’s private OGG source layers, renders, or packages.

**How to apply:** Persist source-layer membership independently of a song project so accepted reference layers survive a refresh before a creator saves a song. Treat source OGGs as analysis/package data only: hydrate bytes only for those internal workflows, never surface playback controls. Keep every saved render addressable through a selectable history UI, not just as a count or a most-recent record.