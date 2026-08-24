# AIM (Advanced Instrument Model) format

## Goal

An `.aim` file is a portable procedural instrument container: a 2026-era successor to SF2. It stores an instrument-specific synthesis profile and one or more OGG timbre-reference layers together, so a compatible host can recreate the character and articulation without treating the source recording as the final playable output.

The core product rule is **reference in, new performance out**. OGG layers are source material for analysis and parameterization, not neural-model training data. A host must not simply trigger the original OGG as a sampler would; it should use the profile, extracted features, procedural DSP, and phrase rules to synthesize a new waveform or a newly generated performance.

## Version 0.1 binary layout

All integers are little-endian.

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0 | 4 | Magic bytes: `AIMF` |
| 4 | 2 | Container version (`1`) |
| 6 | 4 | UTF-8 metadata byte length |
| 10 | 2 | Number of source layers |
| 12 | variable | UTF-8 JSON metadata |
| after metadata | variable | Repeated layer records |

Each layer record contains a 2-byte UTF-8 filename length, a 4-byte payload length, the filename, and the raw OGG bytes.

## Metadata

The metadata describes the instrument identity, host-neutral synthesis graph, engine version, source-layer table, and an explicit engine policy. Version 0.1 uses `engine.mode = procedural-instrument`, `assets[].role = timbre-reference`, and `engine.outputPolicy = new-performance`. It also includes a `specification` block, a stable `engine.runtimeId`, and an `engine.renderContract` so a compliant host knows how to instantiate the mini-synth and what audio it must produce. Hosts should reject unknown major versions and preserve unknown metadata keys when re-saving.

The workbench's verified re-save action downloads the original validated AIMF bytes unchanged. This preserves the exact metadata JSON (including keys unknown to the workbench) and every source-layer payload; it only changes the downloaded filename to identify the verified copy.

## Instrument-specific synthesis

AIM intentionally does not prescribe one universal synthesizer. Each instrument profile defines controls and signal behavior appropriate to its physical mechanism: string/body resonance for acoustic guitar, cabinet/sub sustain for bass, glide and swell for pedal steel, bow pressure and rosin grain for fiddle, and breath/formant behavior for vocals. This profile controls a procedural resynthesis stage, not a sample-zone mapping or neural network.

The browser workbench includes a deterministic feature-conditioned DSP runtime. When OGG layers are attached, each layer is decoded for analysis only; the exported model metadata contains RMS, brightness, transient, duration, and a compact fingerprint. No decoded source waveform is routed to the output.

The generated performance path uses a seeded phrase scheduler and an instrument-specific architecture: plucked-string physical model, subtractive cabinet model, nonlinear amp + string model, gliding harmonic resonator, bowed-string physical model, polyphonic hammer / reed model, or formant and breath synthesizer. Seed and control values are exported alongside the generated-performance record so the result is reproducible.

## MIDI 2.0 instrument definition

MIDI 2.0 is a first-class part of AIM, not merely an optional export format. An AIM package may include a `midi2` definition for each instrument containing:

- UMP endpoint and group assignment
- The instrument’s note range and default tuning
- Per-note controller mappings for articulation parameters
- Registered/per-note controller defaults and ranges
- Pitch-bend, velocity, loudness, and note-attribute mappings
- Profile-specific mappings such as pick attack, bow pressure, pedal glide, breath, vibrato, or cabinet drive

The `.aim` file stores the mapping and engine contract; a host creates and sends the live MIDI 2.0 UMP events. This keeps the package small while allowing each AIM musician to respond differently to the same expressive performance data. A MIDI 1.0 compatibility map may be included for older hosts, but it is not the canonical representation.

## Portability boundary

An `.aim` file is portable across operating systems and CPU architectures because its container is little-endian, its metadata is UTF-8 JSON, its source payloads are raw OGG, and its synthesis graph uses host-neutral values. “Works anywhere” means “works in any host that implements AIMF 0.1 and the named AIM-SYNTH contract”; a random media player or legacy SF2-only sampler cannot render an AIM file by itself. The reference implementation in Instrument Lab is the first compatible host, and future desktop, mobile, plugin, or web hosts should use the same `runtimeId`, render contract, and MIDI 2.0 mapping rather than inventing per-platform behavior.

The browser output is rendered as a new WAV buffer for audition and download. The source OGG payload remains present as reference material for portable retraining, but it is never used as direct playback output.

## Instrument SDK packages

Every individual `.aim` export is accompanied by an `instrument-sdk.zip` package. The SDK contains the matching `.aim` container, the instrument-specific synthesis profile, MIDI 2.0 UMP group and per-note controller mapping, the deterministic runtime contract, a starter note-on event, and integration notes. The SDK does not expose a neural model or turn reference OGG layers into playback samples; it tells an AIM-compatible host how to generate a new performance from the packaged instrument definition.

## Song Studio exports

The AIM Song Studio coordinates the seven defined AIM musicians into a radio-oriented song plan. It uses a title, lyrics, prompt, tempo, and key to create an editable structure that introduces a chorus early, keeps the vocal intelligible, and adds a final-chorus lift.

Its portable `.aimsong.zip` project export contains a master WAV, each available procedural stem, the editable arrangement and MIDI 2.0-oriented group/controller metadata, word-level lyric timing in JSON and LRC forms, seven individual `.aim` packages, and seven matching SDK packages. The vocal engine is a generic formant-and-breath synthesizer guided by timing data; it does not clone or imitate a singer. Every audio file in the export is a newly rendered performance, never an OGG source-layer replay.

## Real-time performance input

Compatible browser hosts may expose the same instrument architecture as a live synth. Computer-key input can map to MIDI pitches, and Web MIDI note-on/note-off messages can drive the voice engine. Live voices must use the active model seed and control values (including articulation) when creating their oscillator, filter, envelope, and modulation state. Live output is synthesized in the host's audio context; reference OGG layers remain analysis-only and are never routed to live output.