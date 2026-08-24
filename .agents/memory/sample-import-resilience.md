---
name: Sample import resilience
description: Folder and sample intake behavior when browser audio analysis cannot decode a source file.
---

Sample analysis must fail per file, not per upload batch. Valid OGG sources continue into curation; unsupported or undecodable files are skipped with a visible in-app message.

**Why:** Browser codec support and malformed source files can make audio decoding fail. Letting one failure escape turns a recoverable source issue into a runtime overlay and loses the rest of the folder.

**How to apply:** Preserve source paths for folder selections, keep a folder-picker fallback, and surface actionable import feedback for empty, non-OGG, or undecodable selections.

In embedded previews, file and folder choosers must be activated with native labels associated with visually hidden file inputs, not `showDirectoryPicker()` or programmatic input clicks.

**Why:** Browser permission and user-activation rules can suppress programmatic chooser requests inside iframes without an application error.

**How to apply:** Keep folder inputs directory-enabled and use direct label activation for the visible upload controls; retain drag-and-drop as the multi-folder path.

Explicit manual control edits and Reset defaults take precedence over asynchronous library hydration; only a newly accepted reference set may force auto-tuning again.

**Why:** A late library response can otherwise silently replace a musician's deliberate settings with an older auto-derived recommendation.

**How to apply:** Guard asynchronous recommendation application with current interaction state, not a render-time snapshot; accepted layers are the only event that clears the user-selection guard.

Library hydration must merge with the latest accepted reference bank instead of replacing it with the request-start snapshot.

**Why:** A slow refresh can otherwise evict a layer accepted while it was pending, leaving controls conditioned on references that no longer appear in the library.

**How to apply:** Preserve layers by stable storage identity and derive recommendations from the exact merged bank.