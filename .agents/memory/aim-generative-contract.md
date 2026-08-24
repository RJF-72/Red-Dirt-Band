---
name: AIM generative contract
description: The product rule distinguishing AIM from a conventional soundfont.
---

AIM source audio is timbre-reference material, not the instrument’s direct playback output or neural training set. Every AIM-compatible engine should produce a new performance through deterministic, instrument-specific procedural resynthesis rather than trigger the stored OGG recordings as sample zones.

**Why:** The user explicitly wants AIM to go beyond legacy SF2 behavior and avoid regurgitating uploaded samples.

**How to apply:** Preserve the container engine policy fields, describe OGG assets as reference-only, and keep all future synth/training features focused on novel generation, controllable articulation, and instrument-specific behavior.

MIDI 2.0 is AIM’s canonical performance interface. Each instrument may carry its own UMP group and per-note controller map inside the `.aim` package; MIDI 1.0 is only a compatibility fallback.

**Why:** The user prefers MIDI 2.0 and AIM’s value is expressive, low-memory studio musicians rather than static sample playback.

**How to apply:** Keep MIDI 2.0 mappings profile-specific for every instrument and avoid flattening expressive events into shared MIDI 1.0 channels.