---
name: Post-merge lockfile recovery
description: Keeping task merges reliable when pnpm workspace catalogs change.
---

Post-merge setup should try a frozen pnpm install first, then non-frozen synchronization when workspace catalog metadata has changed, before running database reconciliation.

**Why:** Merged dependency changes can update pnpm-workspace.yaml without an already-synchronized lockfile, causing a correct frozen install to fail and blocking otherwise valid task merges.

**How to apply:** Keep the fallback non-interactive and fail if both install modes fail; verify a subsequent frozen install succeeds.