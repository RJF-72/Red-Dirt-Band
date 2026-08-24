---
name: Proprietary AIM strategy
description: Current product boundary for AIM distribution and compatibility.
---

AIM is proprietary during the initial product phase. The `.aim` package and procedural runtime should be treated as an internal/private contract, with compatibility limited to the project’s own host until there is a deliberate decision to publish a specification or SDK.

**Why:** The user wants to validate the product and market fit before exposing the format or runtime externally.

**How to apply:** Keep portability work focused on reliable internal round-tripping and versioned contracts; do not publish an open spec, external player, or compatibility promise unless the user changes this decision.