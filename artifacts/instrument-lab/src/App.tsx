import { useEffect, useMemo, useRef, useState } from 'react';
import { ClerkProvider, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { dark } from '@clerk/themes';
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  Download,
  FileArchive,
  FolderOpen,
  Gauge,
  KeyboardMusic,
  LogOut,
  Mic2,
  PackageOpen,
  Play,
  Plus,
  Save,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Waves,
  XCircle,
} from 'lucide-react';
import { AIM_OUTPUT_POLICY, AIM_REFERENCE_ROLE, createPerformancePlan, encodeWav, extractFeatures, seededRandom } from './audio';
import type { LearnedFeatures as AudioLearnedFeatures } from './audio';
import { createLyricTimeline, createRadioArrangement, emptyMusicianMix, toLrc, validateSongInput } from './song';
import type { ArrangementSection, LyricCue, MusicianMix, SongInput } from './song';
import { createZip } from './archive';
import { rankReferenceLayers } from './sample-curation';
import { deriveSampleAdjustedControls, profileDefaultControls, shouldApplySampleAdjustment } from './sample-adjustment';
import { getVerifiedAimDownload, parseAimFile } from './aimf';
import type { AimLayer, ParsedAim } from './aimf';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  theme: dark,
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#d6c4a4',
    colorForeground: '#eee9df',
    colorMutedForeground: '#97a094',
    colorBackground: '#191d19',
    colorInput: '#141714',
    colorInputForeground: '#eee9df',
    colorNeutral: '#3a4338',
    colorDanger: '#df9588',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.5rem',
  },
  elements: {
    cardBox: { width: '28rem', maxWidth: '100%', backgroundColor: '#191d19', border: '1px solid #3a4338', boxShadow: 'none' },
    card: { backgroundColor: 'transparent', boxShadow: 'none' },
    footer: { backgroundColor: 'transparent' },
    headerTitle: { color: '#eee9df' },
    headerSubtitle: { color: '#97a094' },
    formFieldLabel: { color: '#cbd3c7' },
    formFieldInput: { color: '#eee9df', backgroundColor: '#141714', borderColor: '#3a4338' },
    formButtonPrimary: { color: '#20231f', backgroundColor: '#d6c4a4' },
    footerActionText: { color: '#97a094' },
    footerActionLink: { color: '#e5d4b5' },
    dividerText: { color: '#97a094' },
    socialButtonsBlockButtonText: { color: '#eee9df' },
  },
};

type InstrumentId =
  | 'acoustic-guitar'
  | 'bass-guitar'
  | 'electric-guitar'
  | 'pedal-steel'
  | 'fiddle'
  | 'keyboard'
  | 'vocal';

type LearnedFeatures = AudioLearnedFeatures;
type Asset = { name: string; bytes: Uint8Array; url: string; size: string; features?: LearnedFeatures; sourcePath?: string; score?: number; selected?: boolean; objectPath?: string };
type Profile = {
  title: string;
  eyebrow: string;
  color: string;
  description: string;
  architecture: string;
  controls: { label: string; value: string; detail: string }[];
};
type StudioRender = {
  duration: number;
  master: { url: string; bytes: Uint8Array };
  stems: Partial<Record<InstrumentId, { url: string; bytes: Uint8Array }>>;
};
type GenerationInstrument = {
  bytes?: Uint8Array;
  fileName: string;
  sdkBytes?: Uint8Array;
  sdkFileName: string;
  savedAt: string;
  layers: number;
  aimObjectPath?: string;
  sdkObjectPath?: string;
};

type SavedRender = { id: string; savedAt: string; duration: number; masterObjectPath: string; stems: Partial<Record<InstrumentId, string>> };
type CommerceAccess = {
  studioActive: boolean;
  entitlements: { instruments: InstrumentId[]; sdks: InstrumentId[]; commercialSdk: boolean };
  subscription: { id: string; status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: number } | null;
  billingUnavailable?: boolean;
};
type CommerceProduct = {
  id: string;
  name: string;
  description: string | null;
  kind: 'instrument' | 'commercial-sdk' | 'studio';
  entitlement: string | null;
  instrumentId: InstrumentId | null;
  prices: Array<{ id: string; amount: number | null; currency: string; interval: 'month' | 'year' | null; intervalCount: number | null }>;
};
const profiles: Record<InstrumentId, Profile> = {
  'acoustic-guitar': {
    title: 'Acoustic guitar',
    eyebrow: 'String / plucked',
    color: '#c9824b',
    description: 'Wood, finger noise, body resonance, and realistic pick articulation.',
    architecture: 'Plucked-string physical model',
    controls: [
      { label: 'Body resonance', value: '68%', detail: 'Low-mid bloom' },
      { label: 'Pick definition', value: '74%', detail: 'Transient bite' },
      { label: 'Finger noise', value: '21%', detail: 'Performance texture' },
      { label: 'String damping', value: '42%', detail: 'Natural decay' },
    ],
  },
  'bass-guitar': {
    title: 'Bass guitar',
    eyebrow: 'String / low register',
    color: '#5f9c91',
    description: 'Tight low-end, finger-versus-pick attack, and cabinet movement.',
    architecture: 'Subtractive cabinet model',
    controls: [
      { label: 'Cabinet weight', value: '62%', detail: 'Low frequency body' },
      { label: 'Pluck attack', value: '55%', detail: 'Finger / pick edge' },
      { label: 'Sub sustain', value: '78%', detail: 'Long fundamental' },
      { label: 'Fret texture', value: '18%', detail: 'Quiet movement' },
    ],
  },
  'electric-guitar': {
    title: 'Electric guitar',
    eyebrow: 'String / amplified',
    color: '#bc5c59',
    description: 'Amp bloom, pick dynamics, feedback color, and performance bends.',
    architecture: 'Nonlinear amp + string model',
    controls: [
      { label: 'Amp bloom', value: '64%', detail: 'Speaker response' },
      { label: 'Pick bite', value: '71%', detail: 'Upper transient' },
      { label: 'Feedback', value: '12%', detail: 'Sustained color' },
      { label: 'Bend range', value: '48%', detail: 'Pitch articulation' },
    ],
  },
  'pedal-steel': {
    title: 'Pedal steel guitar',
    eyebrow: 'String / gliding',
    color: '#d0a74d',
    description: 'Expressive slides, volume swells, harmonics, and slow-blooming sustain.',
    architecture: 'Gliding harmonic resonator',
    controls: [
      { label: 'Glide time', value: '76%', detail: 'Pedal movement' },
      { label: 'Volume swell', value: '61%', detail: 'Bow-like entrance' },
      { label: 'Harmonics', value: '36%', detail: 'Steel shimmer' },
      { label: 'Vibrato', value: '29%', detail: 'Slow pitch motion' },
    ],
  },
  fiddle: {
    title: 'Fiddle',
    eyebrow: 'String / bowed',
    color: '#a86b89',
    description: 'Bow pressure, rosin grain, vibrato, and lively note-to-note phrasing.',
    architecture: 'Bowed-string physical model',
    controls: [
      { label: 'Bow pressure', value: '58%', detail: 'Rosin intensity' },
      { label: 'Vibrato', value: '47%', detail: 'Hand motion' },
      { label: 'Bowing grain', value: '39%', detail: 'Human texture' },
      { label: 'Portamento', value: '24%', detail: 'Note connection' },
    ],
  },
  keyboard: {
    title: 'Keyboard',
    eyebrow: 'Keys / harmonic',
    color: '#6c87b8',
    description: 'Keybed response, hammer or reed character, pedal tail, and stereo space.',
    architecture: 'Polyphonic hammer / reed model',
    controls: [
      { label: 'Key velocity', value: '67%', detail: 'Dynamic response' },
      { label: 'Hammer tone', value: '42%', detail: 'Attack character' },
      { label: 'Pedal tail', value: '53%', detail: 'Resonant sustain' },
      { label: 'Stereo field', value: '62%', detail: 'Room placement' },
    ],
  },
  vocal: {
    title: 'Vocal',
    eyebrow: 'Voice / expressive',
    color: '#ce7184',
    description: 'Breath, vowel shaping, consonant presence, and intimate phrasing.',
    architecture: 'Formant and breath synthesizer',
    controls: [
      { label: 'Breath texture', value: '31%', detail: 'Air and intimacy' },
      { label: 'Vowel focus', value: '72%', detail: 'Formant clarity' },
      { label: 'Consonant edge', value: '45%', detail: 'Articulation' },
      { label: 'Room presence', value: '28%', detail: 'Close-mic feel' },
    ],
  },
};

const order = Object.keys(profiles) as InstrumentId[];
type ControlBank = Record<InstrumentId, Record<string, number>>;
type ControlMode = 'defaults' | 'auto' | 'manual';
const controlDefinitions = (instrument: InstrumentId) => profiles[instrument].controls.map((control) => ({
  label: control.label,
  defaultValue: Number.parseInt(control.value, 10),
}));
const defaultControlsFor = (instrument: InstrumentId) => profileDefaultControls(controlDefinitions(instrument));
const createControlBank = () => Object.fromEntries(order.map((instrument) => [instrument, defaultControlsFor(instrument)])) as ControlBank;
const createControlModes = () => Object.fromEntries(order.map((instrument) => [instrument, 'defaults'])) as Record<InstrumentId, ControlMode>;
const createAssetBank = () => order.reduce((bank, instrument) => {
  bank[instrument] = [];
  return bank;
}, {} as Record<InstrumentId, Asset[]>);
const assetIdentity = (asset: Asset) => asset.objectPath ?? `${asset.sourcePath ?? asset.name}:${asset.features?.fingerprint ?? asset.size}`;
const mergeAssetBanks = (hydrated: Record<InstrumentId, Asset[]>, current: Record<InstrumentId, Asset[]>) => (
  Object.fromEntries(order.map((instrument) => {
    const seen = new Set(hydrated[instrument].map(assetIdentity));
    return [instrument, [...hydrated[instrument], ...current[instrument].filter((asset) => {
      const identity = assetIdentity(asset);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })]];
  })) as Record<InstrumentId, Asset[]>
);
const COMPUTER_KEYS: Record<string, number> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
};
const midi2Maps: Record<InstrumentId, { group: number; noteRange: [number, number]; perNoteControllers: Record<string, string> }> = {
  'acoustic-guitar': { group: 1, noteRange: [40, 88], perNoteControllers: { 'registered-controllers.1': 'body-resonance', 'registered-controllers.2': 'pick-definition', 'registered-controllers.3': 'finger-noise', 'registered-controllers.4': 'string-damping' } },
  'bass-guitar': { group: 2, noteRange: [28, 67], perNoteControllers: { 'registered-controllers.1': 'cabinet-weight', 'registered-controllers.2': 'pluck-attack', 'registered-controllers.3': 'sub-sustain', 'registered-controllers.4': 'fret-texture' } },
  'electric-guitar': { group: 3, noteRange: [40, 88], perNoteControllers: { 'registered-controllers.1': 'amp-bloom', 'registered-controllers.2': 'pick-bite', 'registered-controllers.3': 'feedback', 'registered-controllers.4': 'bend-range' } },
  'pedal-steel': { group: 4, noteRange: [36, 84], perNoteControllers: { 'registered-controllers.1': 'glide-time', 'registered-controllers.2': 'volume-swell', 'registered-controllers.3': 'harmonics', 'registered-controllers.4': 'vibrato' } },
  fiddle: { group: 5, noteRange: [55, 96], perNoteControllers: { 'registered-controllers.1': 'bow-pressure', 'registered-controllers.2': 'vibrato', 'registered-controllers.3': 'bowing-grain', 'registered-controllers.4': 'portamento' } },
  keyboard: { group: 6, noteRange: [21, 108], perNoteControllers: { 'registered-controllers.1': 'key-velocity', 'registered-controllers.2': 'hammer-tone', 'registered-controllers.3': 'pedal-tail', 'registered-controllers.4': 'stereo-field' } },
  vocal: { group: 7, noteRange: [48, 84], perNoteControllers: { 'registered-controllers.1': 'breath-texture', 'registered-controllers.2': 'vowel-focus', 'registered-controllers.3': 'consonant-edge', 'registered-controllers.4': 'room-presence' } },
};

type LiveVoice = { oscillators: OscillatorNode[]; gain: GainNode };

class LiveEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Map<number, LiveVoice>();

  private ensureContext() {
    if (!this.context) {
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return null;
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.master.gain.value = 0.38;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return this.context;
  }

  noteOn(note: number, velocity: number, instrument: InstrumentId, controls: Record<string, number>, seed: number) {
    const context = this.ensureContext();
    if (!context || !this.master) return;
    this.noteOff(note);
    const values = profiles[instrument].controls.map((control) => controls[control.label] ?? Number.parseInt(control.value, 10));
    const articulation = values.reduce((sum, value) => sum + value, 0) / values.length / 100;
    const random = seededRandom(seed * 997 + note * 7919);
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const osc = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    osc.type = instrument === 'keyboard' ? 'triangle' : instrument === 'vocal' ? 'sine' : instrument === 'electric-guitar' ? 'sawtooth' : 'triangle';
    filter.type = instrument === 'bass-guitar' ? 'lowpass' : instrument === 'vocal' ? 'bandpass' : 'lowpass';
    filter.frequency.value = instrument === 'bass-guitar' ? 650 + articulation * 700 : 1800 + (random() * 0.35 + 0.35) * 2200 + articulation * 1800;
    osc.frequency.value = frequency;
    if (instrument === 'pedal-steel') osc.detune.value = (random() - 0.45) * 35;
    if (instrument === 'fiddle') osc.detune.value = (random() - 0.5) * 14;
    const now = context.currentTime;
    const attack = instrument === 'pedal-steel' || instrument === 'vocal' ? 0.12 + (1 - articulation) * 0.18 : 0.008 + (1 - articulation) * 0.03;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(velocity * (0.15 + articulation * 0.12), now + attack);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    const oscillators = [osc];
    if (instrument === 'acoustic-guitar' || instrument === 'electric-guitar' || instrument === 'keyboard') {
      const overtone = context.createOscillator();
      const overtoneGain = context.createGain();
      overtone.type = 'sine';
      overtone.frequency.value = frequency * 2.01;
      overtoneGain.gain.value = velocity * (instrument === 'keyboard' ? 0.045 : 0.07);
      overtoneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9 + articulation * 0.8);
      overtone.connect(overtoneGain).connect(this.master);
      overtone.start();
      oscillators.push(overtone);
    }
    this.voices.set(note, { oscillators, gain });
  }

  noteOff(note: number) {
    const voice = this.voices.get(note);
    if (!voice || !this.context) return;
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0.001, now, 0.16);
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + 0.7));
    this.voices.delete(note);
  }

  dispose() {
    this.voices.forEach((_, note) => this.noteOff(note));
    if (this.context) void this.context.close();
    this.context = null;
    this.master = null;
  }
}

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 1_000_000 ? 1 : 2)} MB`;
}

function buildAimFile(instrument: InstrumentId, assets: Asset[], controls: Record<string, number>, performance: { seed: number; architecture: string } | null) {
  const midi2 = midi2Maps[instrument];
  const synthSpec = buildPortableSynthSpec(instrument);
  const metadata = {
    format: 'AIM',
    version: 1,
    specification: {
      name: 'AIMF',
      version: '0.1',
      byteOrder: 'little-endian',
      hostRequirement: 'AIM-compatible procedural runtime',
      portability: 'host-neutral metadata; render contract is deterministic across compliant hosts',
    },
    createdAt: new Date().toISOString(),
    instrument,
    engine: {
      mode: 'procedural-instrument',
      runtimeId: `aim.${instrument}.procedural.v1`,
      runtimeVersion: '1.0.0',
      samplePolicy: AIM_REFERENCE_ROLE,
      outputPolicy: AIM_OUTPUT_POLICY,
      synthesis: 'instrument-specific',
      architecture: profiles[instrument].architecture,
      generatedPerformance: performance,
      renderContract: {
        input: 'MIDI 2.0 UMP note and per-note expression events',
        output: 'linear PCM audio',
        sampleRate: 44100,
        channels: 1,
        deterministic: true,
        sourcePlayback: false,
      },
    },
    midi2: {
      protocol: 'MIDI 2.0 UMP',
      version: '1.0',
      group: midi2.group,
      noteRange: midi2.noteRange,
      defaultTuning: '12-TET A4=440Hz',
      velocity: 'MIDI 2.0 note velocity 32-bit normalized to 0..1',
      pitch: 'MIDI 2.0 per-note pitch 32-bit',
      loudness: 'MIDI 2.0 per-note loudness 32-bit',
      noteAttribute: 'profile-specific articulation',
      perNoteControllers: midi2.perNoteControllers,
      compatibility: 'MIDI 1.0 fallback allowed; MIDI 2.0 is canonical',
    },
    synth: { ...profiles[instrument], specVersion: 'AIM-SYNTH 1.0', signalGraph: synthSpec },
    model: {
      version: 1,
      training: 'deterministic-feature-conditioning',
      controls,
      learnedFeatures: assets.map((asset) => ({ name: asset.name, ...asset.features })),
    },
    assets: assets.map((asset) => ({ name: asset.name, type: 'audio/ogg', role: AIM_REFERENCE_ROLE, bytes: asset.bytes.length })),
  };
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  const header = new ArrayBuffer(12);
  const view = new DataView(header);
  new Uint8Array(header, 0, 4).set([0x41, 0x49, 0x4d, 0x46]);
  view.setUint16(4, 1, true);
  view.setUint32(6, json.length, true);
  view.setUint16(10, assets.length, true);
  const chunks: Uint8Array[] = [new Uint8Array(header), json];
  assets.forEach((asset) => {
    const name = new TextEncoder().encode(asset.name);
    const entry = new ArrayBuffer(6);
    const entryView = new DataView(entry);
    entryView.setUint16(0, name.length, true);
    entryView.setUint32(2, asset.bytes.length, true);
    chunks.push(new Uint8Array(entry), name, asset.bytes);
  });
  const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

function buildAimSdkPackage(instrument: InstrumentId, aimBytes: Uint8Array) {
  const encoder = new TextEncoder();
  const midi2 = midi2Maps[instrument];
  const sdkName = `${instrument}-sdk`;
  const manifest = {
    format: 'AIM Instrument SDK',
    version: '0.1',
    instrument,
    aimPackage: `${instrument}.aim`,
    runtime: {
      id: `aim.${instrument}.procedural.v1`,
      version: '1.0.0',
      output: 'linear PCM audio',
      sourcePlayback: false,
      requiredHost: 'AIM-compatible procedural runtime',
    },
    midi2: {
      protocol: 'MIDI 2.0 UMP',
      group: midi2.group,
      noteRange: midi2.noteRange,
      perNoteControllers: midi2.perNoteControllers,
    },
    files: [
      `${sdkName}/manifest.json`,
      `${sdkName}/synth-profile.json`,
      `${sdkName}/midi2.json`,
      `${sdkName}/runtime-contract.json`,
      `${sdkName}/examples/note-on.json`,
      `${sdkName}/${instrument}.aim`,
    ],
  };
  const runtimeContract = {
    runtimeId: `aim.${instrument}.procedural.v1`,
    input: 'MIDI 2.0 UMP note and per-note expression events',
    output: 'linear PCM audio',
    sampleRate: 44100,
    channels: 1,
    deterministic: true,
    sourcePlayback: false,
    referenceLayers: 'analysis-only',
  };
  const noteExample = {
    message: 'MIDI 2.0 UMP note-on example',
    group: midi2.group,
    note: midi2.noteRange[0],
    velocity: 0.8,
    perNoteControllers: Object.fromEntries(Object.keys(midi2.perNoteControllers).map((key) => [key, 0.5])),
  };
  const readme = [
    `# ${profiles[instrument].title} AIM SDK`,
    '',
    'This SDK package provides the instrument AIMF container and the host-facing contract needed to generate new performances.',
    '',
    'The included OGG layers are timbre references only. A compliant host must use the procedural synthesis profile and must not replay the source recordings.',
    '',
    'Start with manifest.json, then send MIDI 2.0 UMP events using midi2.json and runtime-contract.json.',
  ].join('\n');
  return createZip([
    { name: `${sdkName}/README.md`, bytes: encoder.encode(readme) },
    { name: `${sdkName}/manifest.json`, bytes: encoder.encode(JSON.stringify(manifest, null, 2)) },
    { name: `${sdkName}/synth-profile.json`, bytes: encoder.encode(JSON.stringify(buildPortableSynthSpec(instrument), null, 2)) },
    { name: `${sdkName}/midi2.json`, bytes: encoder.encode(JSON.stringify({ protocol: 'MIDI 2.0 UMP', ...midi2 }, null, 2)) },
    { name: `${sdkName}/runtime-contract.json`, bytes: encoder.encode(JSON.stringify(runtimeContract, null, 2)) },
    { name: `${sdkName}/examples/note-on.json`, bytes: encoder.encode(JSON.stringify(noteExample, null, 2)) },
    { name: `${sdkName}/${instrument}.aim`, bytes: aimBytes },
  ]);
}

function buildPortableSynthSpec(instrument: InstrumentId) {
  const common = {
    voiceAllocation: instrument === 'keyboard' ? 'polyphonic' : 'monophonic-legato',
    pitchSource: 'midi2-per-note-pitch',
    velocitySource: 'midi2-note-velocity',
    output: 'mono-linear-pcm',
  };
  const graphs: Record<InstrumentId, Record<string, unknown>> = {
    'acoustic-guitar': { ...common, excitation: 'plucked-string', oscillator: 'triangle', harmonics: 2.01, envelope: { attack: 0.012, decay: 0.85, sustain: 0.28, release: 0.22 }, filter: { type: 'lowpass', cutoffHz: 2800 }, noise: 'finger-noise' },
    'bass-guitar': { ...common, excitation: 'finger-or-pick-pluck', oscillator: 'triangle', harmonics: 1, envelope: { attack: 0.018, decay: 0.42, sustain: 0.74, release: 0.3 }, filter: { type: 'lowpass', cutoffHz: 1200 }, cabinet: 'subtractive-low-end' },
    'electric-guitar': { ...common, excitation: 'amplified-string', oscillator: 'sawtooth', harmonics: 2.01, envelope: { attack: 0.01, decay: 0.7, sustain: 0.58, release: 0.35 }, filter: { type: 'lowpass', cutoffHz: 4200 }, nonlinearity: 'soft-clip-amp' },
    'pedal-steel': { ...common, excitation: 'gliding-string', oscillator: 'triangle', harmonics: 1.5, envelope: { attack: 0.16, decay: 0.7, sustain: 0.74, release: 0.5 }, filter: { type: 'lowpass', cutoffHz: 3600 }, pitchMotion: 'pedal-glide' },
    fiddle: { ...common, excitation: 'bowed-string', oscillator: 'triangle', harmonics: 1.4, envelope: { attack: 0.09, decay: 0.5, sustain: 0.78, release: 0.38 }, filter: { type: 'lowpass', cutoffHz: 3900 }, noise: 'bowing-grain', pitchMotion: 'finger-vibrato' },
    keyboard: { ...common, excitation: 'hammer-or-reed', oscillator: 'triangle', harmonics: 2.01, envelope: { attack: 0.008, decay: 0.5, sustain: 0.5, release: 0.6 }, filter: { type: 'lowpass', cutoffHz: 5200 }, resonance: 'pedal-tail' },
    vocal: { ...common, voiceAllocation: 'monophonic-legato', excitation: 'formant-and-breath', oscillator: 'sine', harmonics: 1, envelope: { attack: 0.16, decay: 0.7, sustain: 0.7, release: 0.55 }, filter: { type: 'bandpass', cutoffHz: 2600 }, noise: 'breath', articulation: 'vowel-and-consonant-shaping' },
  };
  return graphs[instrument];
}

function InstrumentLab({ showCreator, commerceAccess, onRefreshCommerce }: { showCreator: boolean; commerceAccess: CommerceAccess; onRefreshCommerce: () => Promise<void> }) {
  const [active, setActive] = useState<InstrumentId>('acoustic-guitar');
  const [assetBank, setAssetBank] = useState<Record<InstrumentId, Asset[]>>(createAssetBank);
  const [generationLibrary, setGenerationLibrary] = useState<Partial<Record<InstrumentId, GenerationInstrument>>>({});
  const [sampleCandidates, setSampleCandidates] = useState<Asset[]>([]);
  const [candidateInstrument, setCandidateInstrument] = useState<InstrumentId | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [seed, setSeed] = useState(14);
  const [generating, setGenerating] = useState(false);
  const [performance, setPerformance] = useState<{ url: string; seed: number; architecture: string; duration: number } | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [controlBank, setControlBank] = useState<ControlBank>(createControlBank);
  const [controlModes, setControlModes] = useState<Record<InstrumentId, ControlMode>>(createControlModes);
  const [inspected, setInspected] = useState<ParsedAim | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState<number | null>(null);
  const [midiStatus, setMidiStatus] = useState<'unavailable' | 'waiting' | 'connected'>('unavailable');
  const [song, setSong] = useState<SongInput>({ title: '', lyrics: '', prompt: '', tempo: 108, key: 'G major' });
  const [songError, setSongError] = useState<string | null>(null);
  const [arrangement, setArrangement] = useState<ArrangementSection[]>([]);
  const [lyricCues, setLyricCues] = useState<LyricCue[]>([]);
  const [musicianMix, setMusicianMix] = useState<Record<string, MusicianMix>>(emptyMusicianMix);
  const [renderingSong, setRenderingSong] = useState(false);
  const [studioRender, setStudioRender] = useState<StudioRender | null>(null);
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID());
  const [savedProjects, setSavedProjects] = useState<SavedSongProject[]>([]);
  const [savedPackages, setSavedPackages] = useState<SavedPackage[]>([]);
  const [renderHistory, setRenderHistory] = useState<SavedRender[]>([]);
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const assetBankRef = useRef(assetBank);
  assetBankRef.current = assetBank;
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const aimFileRef = useRef<HTMLInputElement>(null);
  const liveEngineRef = useRef<LiveEngine | null>(null);
  const heldNotesRef = useRef(new Set<number>());
  const controlLocksRef = useRef<Record<InstrumentId, boolean>>(Object.fromEntries(order.map((instrument) => [instrument, false])) as Record<InstrumentId, boolean>);
  const profile = profiles[active];
  const assets = assetBank[active];
  const controls = controlBank[active];
  const controlMode = controlModes[active];
  const liveSettingsRef = useRef({ active, controls, seed });
  liveSettingsRef.current = { active, controls, seed };
  const packageSize = useMemo(
    () => assets.reduce((total, asset) => total + asset.bytes.length, 0),
    [assets],
  );
  const hasStudioGenerationAccess = showCreator || commerceAccess.studioActive;
  const generationReady = showCreator ? Object.keys(generationLibrary).length : commerceAccess.studioActive ? order.length : 0;

  function replaceAssetBank(next: Record<InstrumentId, Asset[]>) {
    assetBankRef.current = next;
    setAssetBank(next);
  }

  async function refreshLibrary() {
    try {
      const library = await apiJson<{ projects: SavedSongProject[]; packages: Array<SavedPackage & { layers: string }>; references: SavedReference[] }>('/api/studio/library');
      setSavedProjects(library.projects);
      setSavedPackages(library.packages.map((item) => ({ ...item, layers: Number(item.layers), savedAt: item.updatedAt })));
      setGenerationLibrary((current) => ({ ...current, ...Object.fromEntries(library.packages.map((item) => [item.instrumentId as InstrumentId, {
        fileName: item.fileName, sdkFileName: item.sdkFileName, layers: Number(item.layers), savedAt: item.updatedAt, aimObjectPath: item.aimObjectPath, sdkObjectPath: item.sdkObjectPath,
      }])) }));
      const hydrated = createAssetBank();
      await Promise.all(library.references.map(async (reference) => {
        const response = await fetch(`/api/storage${reference.objectPath}`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Could not restore ${reference.metadata.name}.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        hydrated[reference.instrumentId].push({ ...reference.metadata, objectPath: reference.objectPath, bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' })) });
      }));
      const nextBank = mergeAssetBanks(hydrated, assetBankRef.current);
      replaceAssetBank(nextBank);
      order.forEach((instrument) => applyReferenceRecommendation(instrument, nextBank[instrument]));
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'Your library could not be loaded.');
    }
  }

  useEffect(() => { void refreshLibrary(); }, []);

  async function persistAssets(bank: Record<InstrumentId, Asset[]>) {
    const next = createAssetBank();
    for (const instrument of order) {
      next[instrument] = await Promise.all(bank[instrument].map(async (asset) => ({
        ...asset,
        objectPath: asset.objectPath ?? await uploadPrivateBytes(asset.bytes, asset.name, 'audio/ogg'),
      })));
    }
    return next;
  }

  async function saveSongProject(render?: StudioRender) {
    const validation = validateSongInput(song);
    if (validation) { setSongError(validation); return; }
    setPersistenceStatus('saving');
    setPersistenceError(null);
    try {
      const savedAssets = await persistAssets(assetBank);
      replaceAssetBank(savedAssets);
      let nextHistory = renderHistory;
      if (render) {
        const masterObjectPath = await uploadPrivateBytes(render.master.bytes, `${fileSafe(song.title)}-master.wav`, 'audio/wav');
        const stems = Object.fromEntries(await Promise.all(Object.entries(render.stems).filter((entry): entry is [InstrumentId, { url: string; bytes: Uint8Array }] => Boolean(entry[1])).map(async ([instrument, stem]) => [instrument, await uploadPrivateBytes(stem.bytes, `${fileSafe(song.title)}-${instrument}.wav`, 'audio/wav')]))) as SavedRender['stems'];
        nextHistory = [{ id: crypto.randomUUID(), savedAt: new Date().toISOString(), duration: render.duration, masterObjectPath, stems }, ...renderHistory].slice(0, 12);
        setRenderHistory(nextHistory);
        setSelectedRenderId(nextHistory[0].id);
      }
      const payload = {
        title: song.title.trim(),
        song, arrangement, lyricCues, musicianMix,
        assets: Object.fromEntries(order.map((instrument) => [instrument, savedAssets[instrument].map(({ bytes: _bytes, url: _url, score: _score, selected: _selected, ...asset }) => asset)])),
        renderHistory: nextHistory,
      };
      const project = await apiJson<SavedSongProject>(`/api/studio/projects/${projectId}`, { method: 'PUT', body: JSON.stringify(payload) });
      setProjectId(project.id);
      setSavedProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      setPersistenceStatus('saved');
    } catch (error) {
      setPersistenceStatus('error');
      setPersistenceError(error instanceof Error ? error.message : 'Your project could not be saved.');
    }
  }

  async function openSongProject(id: string) {
    setPersistenceStatus('saving');
    try {
      const project = await apiJson<SavedSongProject>(`/api/studio/projects/${id}`);
      const hydrated = createAssetBank();
      for (const instrument of order) {
        hydrated[instrument] = await Promise.all((project.assets[instrument] ?? []).map(async (asset) => {
          if (!asset.objectPath) throw new Error(`A reference layer in ${project.title} is missing from storage.`);
          const response = await fetch(`/api/storage${asset.objectPath}`, { credentials: 'include' });
          if (!response.ok) throw new Error(`Could not reopen ${asset.name}.`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          return { ...asset, bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' })) };
        }));
      }
      setSong(project.song); setArrangement(project.arrangement); setLyricCues(project.lyricCues); setMusicianMix(project.musicianMix); replaceAssetBank(hydrated);
      order.forEach((instrument) => applyReferenceRecommendation(instrument, hydrated[instrument]));
      const history = project.renderHistory ?? [];
      setRenderHistory(history); setProjectId(project.id);
      if (history[0]) await loadSavedRender(history[0]);
      else { setStudioRender(null); setSelectedRenderId(null); }
      setPersistenceStatus('saved');
    } catch (error) {
      setPersistenceStatus('error');
      setPersistenceError(error instanceof Error ? error.message : 'This project could not be reopened.');
    }
  }

  async function deleteSongProject(id: string) {
    try { await apiJson<void>(`/api/studio/projects/${id}`, { method: 'DELETE' }); setSavedProjects((current) => current.filter((item) => item.id !== id)); } catch (error) { setPersistenceError(error instanceof Error ? error.message : 'This project could not be removed.'); }
  }

  async function deleteInstrumentPackage(instrument: InstrumentId) {
    try {
      await apiJson<void>(`/api/studio/packages/${instrument}`, { method: 'DELETE' });
      setSavedPackages((current) => current.filter((item) => item.instrumentId !== instrument));
      setGenerationLibrary((current) => { const next = { ...current }; delete next[instrument]; return next; });
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'This instrument package could not be removed.');
    }
  }

  async function loadSavedRender(render: SavedRender) {
    try {
      const masterResponse = await fetch(`/api/storage${render.masterObjectPath}`, { credentials: 'include' });
      if (!masterResponse.ok) throw new Error('This saved master could not be reopened.');
      const masterBytes = new Uint8Array(await masterResponse.arrayBuffer());
      const stems = Object.fromEntries(await Promise.all(Object.entries(render.stems).map(async ([instrument, objectPath]) => {
        const response = await fetch(`/api/storage${objectPath}`, { credentials: 'include' });
        if (!response.ok) throw new Error(`Could not reopen the ${instrument} stem.`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return [instrument, { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })) }];
      }))) as StudioRender['stems'];
      if (studioRender) {
        URL.revokeObjectURL(studioRender.master.url);
        Object.values(studioRender.stems).forEach((stem) => stem && URL.revokeObjectURL(stem.url));
      }
      setStudioRender({ duration: render.duration, master: { bytes: masterBytes, url: URL.createObjectURL(new Blob([masterBytes], { type: 'audio/wav' })) }, stems });
      setSelectedRenderId(render.id);
    } catch (error) {
      setPersistenceError(error instanceof Error ? error.message : 'This saved render could not be reopened.');
    }
  }

  async function persistInstrumentPackage(instrument: InstrumentId, item: GenerationInstrument) {
    if (!item.bytes || !item.sdkBytes) return;
    const aimObjectPath = await uploadPrivateBytes(item.bytes, item.fileName, 'application/x-aim');
    const sdkObjectPath = await uploadPrivateBytes(item.sdkBytes, item.sdkFileName, 'application/zip');
    await apiJson(`/api/studio/packages/${instrument}`, { method: 'PUT', body: JSON.stringify({ fileName: item.fileName, sdkFileName: item.sdkFileName, aimObjectPath, sdkObjectPath, layers: item.layers }) });
    await refreshLibrary();
  }

  useEffect(() => {
    const engine = liveEngineRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      const note = COMPUTER_KEYS[event.key.toLowerCase()];
      if (note !== undefined) {
        event.preventDefault();
        heldNotesRef.current.add(note);
        startLiveNote(note, 0.78);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const note = COMPUTER_KEYS[event.key.toLowerCase()];
      if (note !== undefined) {
        heldNotesRef.current.delete(note);
        stopLiveNote(note);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      engine?.dispose();
      liveEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.requestMIDIAccess) {
      setMidiStatus('unavailable');
      return;
    }
    setMidiStatus('waiting');
    navigator.requestMIDIAccess().then((access) => {
      if (cancelled) return;
      setMidiStatus(access.inputs.size ? 'connected' : 'waiting');
      access.inputs.forEach((input) => {
        input.onmidimessage = (message) => {
          const data = message.data;
          if (!data) return;
          const [status, note, velocity] = data;
          const command = status & 0xf0;
          if (command === 0x90 && velocity > 0) {
            heldNotesRef.current.add(note);
            startLiveNote(note, velocity / 127);
          } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
            heldNotesRef.current.delete(note);
            stopLiveNote(note);
          }
        };
      });
    }).catch(() => setMidiStatus('unavailable'));
    return () => { cancelled = true; };
  }, []);

  function startLiveNote(note: number, velocity: number) {
    if (!liveEngineRef.current) liveEngineRef.current = new LiveEngine();
    const settings = liveSettingsRef.current;
    liveEngineRef.current.noteOn(note, velocity, settings.active, settings.controls, settings.seed);
    setLiveNote(note);
  }

  function stopLiveNote(note: number) {
    liveEngineRef.current?.noteOff(note);
    if (liveNote === note) setLiveNote(null);
  }

  function setControlLock(instrument: InstrumentId, locked: boolean) {
    controlLocksRef.current = { ...controlLocksRef.current, [instrument]: locked };
  }

  function applyReferenceRecommendation(instrument: InstrumentId, referenceAssets: Asset[], force = false) {
    if (!shouldApplySampleAdjustment(controlLocksRef.current[instrument], force)) return;
    const adjustment = deriveSampleAdjustedControls(
      instrument,
      controlDefinitions(instrument),
      referenceAssets.map((asset) => asset.features),
    );
    if (!adjustment.adjusted) return;
    setControlBank((current) => ({ ...current, [instrument]: adjustment.controls }));
    setControlModes((current) => ({ ...current, [instrument]: 'auto' }));
    if (force) setControlLock(instrument, false);
  }

  function updateControl(label: string, value: number) {
    setControlBank((current) => ({ ...current, [active]: { ...current[active], [label]: value } }));
    setControlModes((current) => ({ ...current, [active]: 'manual' }));
    setControlLock(active, true);
  }

  function resetControlsToDefaults() {
    setControlBank((current) => ({ ...current, [active]: defaultControlsFor(active) }));
    setControlModes((current) => ({ ...current, [active]: 'defaults' }));
    setControlLock(active, true);
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const selectedFiles = Array.from(files);
    if (!selectedFiles.length) {
      setUploadError('No files were selected. Choose a folder containing OGG files and try again.');
      return;
    }
    const oggFiles = selectedFiles.filter((file) => file.name.toLowerCase().endsWith('.ogg'));
    if (!oggFiles.length) {
      setUploadError('No .ogg files were found in that selection. AIM source layers must be OGG files.');
      return;
    }
    const analyzed: Array<Asset | null> = await Promise.all(
      oggFiles.map(async (file): Promise<Asset | null> => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          return {
            name: file.name,
            bytes,
            url: URL.createObjectURL(file),
            size: formatBytes(file.size),
            sourcePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
           features: await analyzeReference(bytes),
          };
        } catch {
          return null;
        }
      }),
    );
    const next = analyzed.filter((asset): asset is Asset => asset !== null);
    if (!next.length) {
      setUploadError('None of the selected OGG files could be analyzed. Check that the files contain supported OGG audio and try again.');
      return;
    }
    const rejectedCount = oggFiles.length - next.length;
    setUploadError(rejectedCount ? `${rejectedCount} OGG file${rejectedCount === 1 ? '' : 's'} could not be analyzed and were skipped. The remaining files are ready for review.` : null);
    setSampleCandidates((current) => {
      if (candidateInstrument && candidateInstrument !== active) {
        current.forEach((candidate) => URL.revokeObjectURL(candidate.url));
        return rankReferenceLayers(active, next);
      }
      return rankReferenceLayers(active, [...current, ...next]);
    });
    setCandidateInstrument(active);
  }

  async function collectDroppedFiles(items: DataTransferItemList) {
    const readEntry = (entry: FileSystemEntry): Promise<File[]> => {
      if (entry.isFile) {
        return new Promise((resolve, reject) => (entry as FileSystemFileEntry).file((file) => resolve([file]), reject));
      }
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      return new Promise((resolve, reject) => {
        const all: File[] = [];
        const readBatch = () => reader.readEntries((batch) => {
          if (!batch.length) {
            Promise.all(all.map((file) => Promise.resolve(file))).then(resolve).catch(reject);
            return;
          }
          Promise.all(batch.map(readEntry)).then((files) => {
            all.push(...files.flat());
            readBatch();
          }).catch(reject);
        }, reject);
        readBatch();
      });
    };
    const entries = Array.from(items).map((item) => item.webkitGetAsEntry?.()).filter((entry): entry is FileSystemEntry => Boolean(entry));
    const files = await Promise.all(entries.map(readEntry));
    return files.flat();
  }

  async function acceptCandidates() {
    const chosen = sampleCandidates.filter((candidate) => candidate.selected);
    if (!chosen.length) return;
    setPersistenceStatus('saving');
    try {
      const ready = await Promise.all(chosen.map(async ({ selected: _selected, score: _score, ...asset }) => ({
        ...asset,
        objectPath: await uploadPrivateBytes(asset.bytes, asset.name, 'audio/ogg'),
      })));
      await apiJson(`/api/studio/references/${active}`, {
        method: 'POST',
        body: JSON.stringify({ layers: ready.map(({ objectPath, name, size, features, sourcePath }) => ({
          objectPath,
          metadata: { name, size, features, sourcePath },
        })) }),
      });
      const nextBank = { ...assetBankRef.current, [active]: [...assetBankRef.current[active], ...ready] };
      replaceAssetBank(nextBank);
      applyReferenceRecommendation(active, nextBank[active], true);
      setSampleCandidates([]);
      setCandidateInstrument(null);
      setPersistenceStatus('saved');
    } catch (error) {
      setPersistenceStatus('error');
      setPersistenceError(error instanceof Error ? error.message : 'The selected reference layers could not be stored.');
    }
  }

  function toggleCandidate(sourcePath: string) {
    setSampleCandidates((current) => current.map((candidate) => candidate.sourcePath === sourcePath ? { ...candidate, selected: !candidate.selected } : candidate));
  }

  async function inspectAim(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setInspectError(null);
    setInspected(null);
    try {
      setInspected(parseAimFile(file.name, new Uint8Array(await file.arrayBuffer())));
    } catch (error) {
      setInspectError(error instanceof Error ? error.message : 'This AIM package could not be read.');
    }
  }

  function validateInspected() {
    if (inspected) setInspected({ ...inspected });
    else setInspectError('Select an exported .aim package first. AIMF header, container version, metadata, and source layers will be checked here.');
  }

  function exportAim() {
    const bytes = buildAimFile(active, assets, controls, performance ? { seed: performance.seed, architecture: performance.architecture } : null);
    const fileName = `${active}.aim`;
    const sdkBytes = buildAimSdkPackage(active, bytes);
    const sdkFileName = `${active}-sdk.zip`;
    downloadAim(bytes, fileName);
    window.setTimeout(() => downloadBytes(sdkBytes, sdkFileName, 'application/zip'), 120);
    const item = { bytes, fileName, sdkBytes, sdkFileName, savedAt: new Date().toISOString(), layers: assets.length };
    setGenerationLibrary((current) => ({ ...current, [active]: item }));
    void persistInstrumentPackage(active, item).catch((error) => setPersistenceError(error instanceof Error ? error.message : 'The instrument package could not be added to your library.'));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2400);
  }

  function resaveInspected() {
    if (!inspected) return;
    const download = getVerifiedAimDownload(inspected);
    downloadAim(download.bytes, download.fileName);
  }

  function downloadAim(bytes: Uint8Array, fileName: string) {
    const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type: 'application/x-aim' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function previewGenerated() {
    setGenerating(true);
    setRenderError(null);
    try {
      const result = await generatePerformance(active, controls, assets, seed);
      if (performance) URL.revokeObjectURL(performance.url);
      const url = URL.createObjectURL(new Blob([result.wav], { type: 'audio/wav' }));
      setPerformance({ url, seed: result.seed, architecture: result.architecture, duration: result.duration });
      // Playback is best-effort. Do not make Generate wait on an autoplay
      // promise that some browsers leave pending indefinitely.
      void new Audio(url).play().catch(() => {
        // Browser autoplay policies may block preview playback, but the WAV is
        // still rendered and available through the download link.
      });
    } catch (error) {
      console.error('Performance render failed:', error);
      setRenderError(error instanceof Error ? error.message : 'The performance could not be rendered. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  function planSong() {
    const error = validateSongInput(song);
    if (error) {
      setSongError(error);
      return;
    }
    const nextArrangement = createRadioArrangement(song.tempo);
    setArrangement(nextArrangement);
    setLyricCues(createLyricTimeline(song.lyrics, nextArrangement));
    setSongError(null);
  }

  function updateMusician(instrument: InstrumentId, update: Partial<MusicianMix>) {
    setMusicianMix((current) => ({ ...current, [instrument]: { ...current[instrument], ...update } }));
  }

  function toggleArrangementInstrument(sectionId: string, instrument: InstrumentId) {
    setArrangement((current) => {
      const next = current.map((section) => section.id === sectionId
        ? { ...section, musicians: section.musicians.includes(instrument) ? section.musicians.filter((id) => id !== instrument) : [...section.musicians, instrument] }
        : section);
      setLyricCues(createLyricTimeline(song.lyrics, next));
      return next;
    });
  }

  async function renderSongProject() {
    if (!hasStudioGenerationAccess) {
      setSongError('An active AIM Music Studio subscription is required to render songs. Choose a Studio plan above to continue.');
      return;
    }
    try {
      await apiJson('/api/commerce/generation-access', { method: 'POST' });
    } catch (error) {
      setSongError(error instanceof Error ? error.message : 'Studio access could not be verified. Please try again.');
      return;
    }
    const error = validateSongInput(song);
    if (error) {
      setSongError(error);
      return;
    }
    const nextArrangement = arrangement.length ? arrangement : createRadioArrangement(song.tempo);
    if (!arrangement.length) {
      setArrangement(nextArrangement);
      setLyricCues(createLyricTimeline(song.lyrics, nextArrangement));
    }
    setRenderingSong(true);
    setSongError(null);
    try {
      const result = await renderStudioArrangement(nextArrangement, song, musicianMix, assetBank, controlBank, seed);
      if (studioRender) {
        URL.revokeObjectURL(studioRender.master.url);
        Object.values(studioRender.stems).forEach((stem) => stem && URL.revokeObjectURL(stem.url));
      }
      setStudioRender(result);
      void saveSongProject(result);
    } catch {
      setSongError('The studio render could not be completed in this browser. Try again with a shorter lyric sheet or a different seed.');
    } finally {
      setRenderingSong(false);
    }
  }

  function downloadSongProject() {
    if (!studioRender) return;
    const manifest = {
      format: 'AIM Song Project',
      version: 1,
      title: song.title,
      prompt: song.prompt,
      tempo: song.tempo,
      key: song.key,
      arrangement,
      lyricTiming: lyricCues,
      lyricLrc: toLrc(lyricCues),
      midi2: {
        protocol: 'MIDI 2.0 UMP',
        instruments: order.map((instrument) => ({ instrument, ...midi2Maps[instrument] })),
      },
       outputs: ['master.wav', ...order.map((instrument) => `${instrument}.wav`), 'lyrics.lrc', 'lyrics.json', ...(showCreator ? order.flatMap((instrument) => [`${instrument}.aim`, `${instrument}-sdk.zip`]) : [])],
      renderedDuration: studioRender.duration,
    };
    const name = fileSafe(song.title);
    const encoder = new TextEncoder();
    const entries = [
      { name: `${name}/project.aim-song.json`, bytes: encoder.encode(JSON.stringify(manifest, null, 2)) },
      { name: `${name}/lyrics.lrc`, bytes: encoder.encode(toLrc(lyricCues)) },
      { name: `${name}/lyrics.json`, bytes: encoder.encode(JSON.stringify(lyricCues, null, 2)) },
      { name: `${name}/audio/master.wav`, bytes: studioRender.master.bytes },
      ...Object.entries(studioRender.stems).filter((entry): entry is [string, { url: string; bytes: Uint8Array }] => Boolean(entry[1])).map(([instrument, stem]) => ({ name: `${name}/audio/${instrument}.wav`, bytes: stem.bytes })),
       ...(showCreator ? order.flatMap((instrument) => {
        const aimBytes = buildAimFile(instrument, assetBank[instrument], controlBank[instrument], null);
        return [
          { name: `${name}/instruments/${instrument}.aim`, bytes: aimBytes },
          { name: `${name}/sdks/${instrument}-sdk.zip`, bytes: buildAimSdkPackage(instrument, aimBytes) },
        ];
       }) : []),
    ];
    downloadBytes(createZip(entries), `${name}.aimsong.zip`, 'application/zip');
  }

  function downloadInstrumentPackages() {
    order.forEach((instrument, index) => {
      window.setTimeout(() => {
        const bytes = buildAimFile(instrument, assetBank[instrument], controlBank[instrument], null);
        const sdkBytes = buildAimSdkPackage(instrument, bytes);
        const fileName = `${instrument}.aim`;
        const sdkFileName = `${instrument}-sdk.zip`;
        const item = { bytes, fileName, sdkBytes, sdkFileName, savedAt: new Date().toISOString(), layers: assetBank[instrument].length };
        setGenerationLibrary((current) => ({ ...current, [instrument]: item }));
        void persistInstrumentPackage(instrument, item).catch((error) => setPersistenceError(error instanceof Error ? error.message : 'The instrument package could not be added to your library.'));
        downloadAim(bytes, `${instrument}.aim`);
        window.setTimeout(() => downloadBytes(sdkBytes, sdkFileName, 'application/zip'), 120);
      }, index * 240);
    });
  }

  async function downloadLicensedPackages(instruments: InstrumentId[], license: 'personal' | 'commercial') {
    await Promise.all(instruments.map((instrument) => apiJson(`/api/commerce/package-access/${instrument}`, {
      method: 'POST',
      body: JSON.stringify({ license }),
    })));
    instruments.forEach((instrument, index) => {
      window.setTimeout(() => {
        const bytes = buildAimFile(instrument, [], {}, null);
        downloadAim(bytes, `${instrument}.aim`);
        window.setTimeout(() => downloadBytes(buildAimSdkPackage(instrument, bytes), `${instrument}-sdk.zip`, 'application/zip'), 120);
      }, index * 240);
    });
  }

  return (
    <main className={`aim-app ${showCreator ? '' : 'subscriber-app'}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Waves size={21} /></div>
          <div><strong>AIM</strong><span>{showCreator ? 'Instrument Lab' : 'Music Studio'}</span></div>
        </div>
        {showCreator ? <>
          <div className="side-label">Library</div>
          <button className="side-item active"><Sparkles size={17} /> AIM workbench <span className="side-dot" /></button>
          <button className="side-item" onClick={() => aimFileRef.current?.click()}><FolderOpen size={17} /> My instruments</button>
          <button className="side-item"><FileArchive size={17} /> Exported packages</button>
          <input ref={aimFileRef} type="file" accept=".aim,application/x-aim" hidden onChange={(event) => inspectAim(event.target.files)} />
          <div className="side-label model-label">Model studio</div>
          <div className="model-count"><span>7</span> instrument models <span className="ready">ready</span></div>
        </> : <>
          <div className="side-label">Subscriber studio</div>
          <button className="side-item active"><Sparkles size={17} /> Music generation <span className="side-dot" /></button>
          <button className="side-item"><PackageOpen size={17} /> My instruments</button>
        </>}
        <div className="sidebar-bottom">
          <div className="status-line"><span className="pulse" /> Local engine online</div>
          <p>AIM format v0.1</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
            <div>
              <div className="crumb">{showCreator ? <>WORKBENCH <span>/</span> NEW INSTRUMENT</> : <>MUSIC GENERATION <span>/</span> SONG STUDIO</>}</div>
              <h1>{showCreator ? 'Compose an AIM instrument' : 'Create a new performance'}</h1>
            </div>
          <div className="top-actions">
              {showCreator && <><span className="draft"><span /> Unsaved changes</span><button className="ghost-btn" onClick={validateInspected}><Gauge size={16} /> Validate</button><button className="primary-btn" onClick={exportAim}><Save size={16} /> {saved ? 'Exported .aim + SDK' : 'Export .aim + SDK'}</button></>}
              <SessionControls />
          </div>
        </header>

        <div className="content">
          <section className="intro">
            <div>
              <p className="kicker">{showCreator ? 'THE NEXT GENERATION OF INSTRUMENT FILES' : 'PROCEDURAL MUSIC GENERATION'}</p>
              <h2>{showCreator ? <>Samples are the material.<br /><em>The instrument is the idea.</em></> : <>Build the song.<br /><em>Keep the performance human.</em></>}</h2>
              <p className="intro-copy">{showCreator ? 'Build a playable instrument with its own embedded mini-synth, articulation logic, and OGG source layers. AIM packages the sound and the behavior together.' : 'Shape a complete arrangement with seven distinct procedural musicians, editable sections, stem controls, and synchronized lyric timing.'}</p>
            </div>
            <div className="format-badge"><span className="badge-icon"><PackageOpen size={18} /></span><span><b>{showCreator ? 'AIMF' : 'AIM STUDIO'}</b><small>{showCreator ? 'container format · v0.1' : 'subscriber workspace'}</small></span></div>
          </section>
          <CommercePanel access={commerceAccess} onRefresh={onRefreshCommerce} onDownloadPackages={downloadLicensedPackages} />

          <section className="song-studio">
            <div className="studio-heading">
              <div><p className="kicker">AIM SONG STUDIO</p><h2>Build the band.<br /><em>Keep the song moving.</em></h2></div>
              <div className="studio-spec"><b>7 AIM MUSICIANS</b><span>procedural · MIDI 2.0 ready · no voice cloning</span></div>
            </div>
            <div className="generation-library"><div className="generation-library-head"><span className="inspector-label">MUSIC GENERATION LIBRARY</span><span>{generationReady}/7 AIM instruments ready</span></div><div className="generation-library-grid">{order.map((instrument) => { const item = generationLibrary[instrument]; const ready = Boolean(item) || (!showCreator && commerceAccess.studioActive); return <div key={instrument} className={`generation-instrument ${ready ? 'ready' : ''}`}><span className="mixer-dot" style={{ background: profiles[instrument].color }} /><b>{profiles[instrument].title}</b><small>{item ? `ready · ${item.layers} reference layers` : showCreator ? 'export this instrument to add it' : commerceAccess.studioActive ? 'included in your studio' : 'Studio subscription required'}</small></div>; })}</div></div>
            {!hasStudioGenerationAccess && <div className="studio-lock"><AlertCircle size={17} /><div><b>Song rendering is locked</b><p>An active AIM Music Studio subscription is required for new generated performances. Your account and instrument licenses remain available.</p></div><button className="primary-btn" onClick={() => document.getElementById('aim-store')?.scrollIntoView({ behavior: 'smooth' })}>Choose Studio</button></div>}
            <section className="saved-library" aria-label="Saved projects and instrument packages">
              <div className="generation-library-head"><div><span className="inspector-label">YOUR LIBRARY</span><p>Private source layers are retained for analysis and packaging only; they are never served as playback samples.</p></div><button className="text-btn" onClick={() => void refreshLibrary()}><FolderOpen size={13} /> Refresh library</button></div>
              {persistenceError && <p className="song-error" role="alert">{persistenceError}</p>}
              <div className="saved-library-grid">
                <div><h3>Song projects</h3>{savedProjects.length ? <ul>{savedProjects.map((project) => <li key={project.id}><span><b>{project.title}</b><small>saved {new Date(project.updatedAt).toLocaleDateString()} · {project.renderHistory?.length ?? 0} renders</small></span><button className="text-btn" onClick={() => void openSongProject(project.id)}>Open</button><button className="text-btn danger" onClick={() => void deleteSongProject(project.id)}>Remove</button></li>)}</ul> : <p className="empty-library">Save a song setup to reopen it on any device.</p>}</div>
                <div><h3>Instrument packages</h3>{savedPackages.length ? <ul>{savedPackages.map((item) => <li key={item.instrumentId}><span><b>{profiles[item.instrumentId]?.title ?? item.instrumentId}</b><small>{item.layers} reference layers · saved {new Date(item.updatedAt).toLocaleDateString()}</small></span><a className="text-btn" href={`/api/storage${item.aimObjectPath}`} download={item.fileName}>AIM</a><a className="text-btn" href={`/api/storage${item.sdkObjectPath}`} download={item.sdkFileName}>SDK</a><button className="text-btn danger" onClick={() => void deleteInstrumentPackage(item.instrumentId)}>Remove</button></li>)}</ul> : <p className="empty-library">Export an AIM instrument to keep its private package here.</p>}</div>
              </div>
            </section>
            <div className="song-setup">
              <label><span>Song title <b>{song.title.length}/50</b></span><input maxLength={50} value={song.title} onChange={(event) => setSong((current) => ({ ...current, title: event.target.value }))} placeholder="Neon on the county line" /></label>
              <label><span>Tempo <b>BPM</b></span><input type="number" min="60" max="180" value={song.tempo} onChange={(event) => setSong((current) => ({ ...current, tempo: Math.max(60, Math.min(180, Number(event.target.value) || 108)) }))} /></label>
              <label><span>Key</span><input value={song.key} onChange={(event) => setSong((current) => ({ ...current, key: event.target.value }))} /></label>
              <label className="song-wide"><span>Production prompt <b>{song.prompt.length}/2500</b></span><textarea maxLength={2500} value={song.prompt} onChange={(event) => setSong((current) => ({ ...current, prompt: event.target.value }))} placeholder="Radio-ready country-pop with a wide final chorus, warm steel guitar, and a clear vocal." /></label>
              <label className="song-wide"><span>Lyrics <b>{song.lyrics.length}/5000</b></span><textarea maxLength={5000} value={song.lyrics} onChange={(event) => setSong((current) => ({ ...current, lyrics: event.target.value }))} placeholder={'[Verse]\nI was driving through the midnight rain...\n\n[Chorus]\nHold on, hold on...'} /></label>
            </div>
            <div className="studio-actions">
              <div>{songError && <span className="song-error">{songError}</span>} {!songError && <span className="song-guidance">AIM places the first chorus early, leaves room for the vocal, then lifts the final chorus.</span>}</div>
              <div className="studio-buttons"><button className="ghost-btn" onClick={planSong}><Gauge size={16} /> Plan arrangement</button><button className="ghost-btn" onClick={() => void saveSongProject()} disabled={persistenceStatus === 'saving'}><Save size={16} /> {persistenceStatus === 'saving' ? 'Saving…' : persistenceStatus === 'saved' ? 'Saved to library' : 'Save project'}</button><button className="primary-btn" onClick={hasStudioGenerationAccess ? renderSongProject : () => document.getElementById('aim-store')?.scrollIntoView({ behavior: 'smooth' })} disabled={renderingSong}><Play size={16} fill="currentColor" /> {renderingSong ? 'Rendering studio…' : hasStudioGenerationAccess ? 'Render song' : 'Subscribe to render'}</button></div>
            </div>
            {arrangement.length > 0 && <div className="arrangement-panel">
              <div className="arrangement-head"><div><span className="step">ARRANGEMENT</span><h3>Radio structure · {song.tempo} BPM · {song.key}</h3></div><span>{Math.ceil(arrangement.at(-1)!.start + arrangement.at(-1)!.duration)} seconds planned</span></div>
              <div className="arrangement-track">{arrangement.map((section) => <div key={section.id} className={`section-block ${section.energy}`} style={{ flex: section.duration }}><b>{section.name}</b><small>{Math.round(section.duration)}s · {section.musicians.length} players</small></div>)}</div>
              <div className="section-editor">{arrangement.map((section) => <div className="section-editor-row" key={section.id}><b>{section.name}</b><div>{order.map((instrument) => <button key={instrument} className={section.musicians.includes(instrument) ? 'section-player on' : 'section-player'} onClick={() => toggleArrangementInstrument(section.id, instrument)}>{profiles[instrument].title.replace(' guitar', '')}</button>)}</div></div>)}</div>
              <div className="studio-grid">
                <div className="musician-mixer"><span className="inspector-label">MUSICIANS · EACH HAS ITS OWN AIM SYNTH + MIDI 2.0 PROFILE</span>{order.map((instrument) => {
                  const mix = musicianMix[instrument];
                  return <div className={`mixer-row ${mix.muted ? 'is-muted' : ''}`} key={instrument}><span className="mixer-dot" style={{ background: profiles[instrument].color }} /><b>{profiles[instrument].title}</b><label>level <input type="range" min="0" max="100" value={mix.level} onChange={(event) => updateMusician(instrument, { level: Number(event.target.value) })} /></label><label>energy <input type="range" min="0" max="100" value={mix.intensity} onChange={(event) => updateMusician(instrument, { intensity: Number(event.target.value) })} /></label><label>space <input type="range" min="0" max="100" value={mix.space} onChange={(event) => updateMusician(instrument, { space: Number(event.target.value) })} /></label><button className={mix.muted ? 'mix-toggle on' : 'mix-toggle'} onClick={() => updateMusician(instrument, { muted: !mix.muted })}>M</button><button className={mix.solo ? 'mix-toggle on' : 'mix-toggle'} onClick={() => updateMusician(instrument, { solo: !mix.solo })}>S</button></div>;
                })}</div>
                <div className="teleprompter"><span className="inspector-label">KARAOKE TELEPROMPTER · PHRASE TIMING</span>{lyricCues.length ? <div className="lyric-cues">{lyricCues.slice(0, 36).map((cue, index) => <span key={`${cue.word}-${index}`} className={cue.section.includes('Chorus') ? 'chorus-word' : ''}><i>{Math.floor(cue.start / 60)}:{String(Math.floor(cue.start % 60)).padStart(2, '0')}</i>{cue.word}</span>)}</div> : <p>Plan the arrangement to map lyrics to exact vocal entry points.</p>}</div>
              </div>
            </div>}
            {studioRender && <div className="render-results">
              <div><span className="step">READY TO DOWNLOAD</span><h3>{song.title || 'AIM song'} · master, stems, and timing</h3><p>{studioRender.duration.toFixed(0)} second rendered preview with seven synchronized AIM performers.</p></div>
                <div className="render-downloads"><a className="primary-btn" href={studioRender.master.url} download={`${fileSafe(song.title)}-master.wav`}><Download size={15} /> Master WAV</a><button className="ghost-btn" onClick={downloadSongProject}><FileArchive size={15} /> Download song ZIP</button>{showCreator && <button className="ghost-btn" onClick={downloadInstrumentPackages}><PackageOpen size={15} /> 7 AIM instruments + SDKs</button>}</div>
              <div className="stem-downloads">{order.map((instrument) => studioRender.stems[instrument] && <a key={instrument} href={studioRender.stems[instrument]!.url} download={`${fileSafe(song.title)}-${instrument}.wav`}>{profiles[instrument].title} stem <Download size={12} /></a>)}</div>
            </div>}
            {renderHistory.length > 1 && <div className="render-history" aria-label="Saved render history"><span className="inspector-label">SAVED RENDER HISTORY</span><div>{renderHistory.map((render, index) => <button key={render.id} className={selectedRenderId === render.id ? 'selected' : ''} onClick={() => void loadSavedRender(render)}><b>{index === 0 ? 'Latest render' : `Render ${renderHistory.length - index}`}</b><small>{new Date(render.savedAt).toLocaleString()} · {render.duration.toFixed(0)} seconds</small></button>)}</div></div>}
          </section>

          {showCreator && (inspected || inspectError) && <section className={`inspector ${inspectError ? 'inspector-error' : 'inspector-valid'}`}>
            <div className="inspector-head">
              <div className="inspector-title"><span className="step">OPEN PACKAGE</span><h3>{inspected ? inspected.fileName : 'AIM package could not be opened'}</h3></div>
              <button className="inspector-close" aria-label="Close package inspector" onClick={() => { setInspected(null); setInspectError(null); }}><XCircle size={17} /></button>
            </div>
            {inspected ? <>
              <div className="validation-banner"><CheckCircle2 size={17} /><div><b>Valid AIMF package</b><span>Signature, container structure, metadata, and source-layer manifest verified.</span></div><strong>v0.1</strong><button className="resave-btn" onClick={resaveInspected}><Download size={13} /> Re-save verified .aim</button></div>
              <div className="inspector-grid">
                <div className="inspector-block"><span className="inspector-label">INSTRUMENT METADATA</span><dl>
                  <dt>Identity</dt><dd>{inspected.metadata.synth?.title ?? inspected.metadata.instrument ?? 'Unspecified'}</dd>
                  <dt>Family</dt><dd>{inspected.metadata.synth?.eyebrow ?? '—'}</dd>
                  <dt>Description</dt><dd>{inspected.metadata.synth?.description ?? '—'}</dd>
                  <dt>Model</dt><dd>{inspected.metadata.model?.version ? `v${inspected.metadata.model.version} · ${inspected.metadata.model.training ?? 'feature conditioned'}` : '—'}</dd>
                </dl></div>
                <div className="inspector-block"><span className="inspector-label">ENGINE POLICY</span><dl>
                  <dt>Mode</dt><dd>{inspected.metadata.engine?.mode ?? '—'}</dd>
                  <dt>Output</dt><dd>{inspected.metadata.engine?.outputPolicy ?? '—'}</dd>
                  <dt>Source policy</dt><dd>{inspected.metadata.engine?.samplePolicy ?? '—'}</dd>
                  <dt>Architecture</dt><dd>{inspected.metadata.engine?.architecture ?? '—'}</dd>
                   <dt>Runtime</dt><dd>{inspected.metadata.engine?.runtimeId ?? 'Legacy AIM metadata'}</dd>
                   <dt>Portability</dt><dd>{inspected.metadata.specification?.hostRequirement ?? 'AIM-compatible host required'}</dd>
                </dl></div>
                <div className="inspector-block inspector-layers"><span className="inspector-label">SOURCE-LAYER MANIFEST · {inspected.layers.length} LAYERS</span>
                  {inspected.layers.map((layer, index) => <div className="manifest-row" key={`${layer.name}-${index}`}><span className="manifest-index">{String(index + 1).padStart(2, '0')}</span><b>{layer.name}</b><span>{formatBytes(layer.bytes)} · {inspected.metadata.assets[index]?.role ?? 'reference'}</span></div>)}
                  <div className="manifest-total"><span>Package size</span><b>{formatBytes(inspected.totalBytes)}</b></div>
                </div>
              </div>
            </> : <div className="recovery-message"><XCircle size={18} /><div><b>Unable to inspect this package</b><p>{inspectError}</p><span>Choose a valid .aim export from this workbench, or export the current instrument again.</span></div><button className="upload-btn" onClick={() => aimFileRef.current?.click()}><FolderOpen size={13} /> Choose another file</button></div>}
          </section>}

          {showCreator && <><div className="section-heading"><div><span className="step">01</span><h3>Choose an instrument</h3></div><span className="hint">Each model has its own synthesis vocabulary</span></div>
          <div className="instrument-grid">
            {order.map((id) => (
              <button key={id} className={`instrument-card ${active === id ? 'selected' : ''}`} style={{ '--instrument-color': profiles[id].color } as React.CSSProperties} onClick={() => setActive(id)}>
                <span className="instrument-icon"><AudioLines size={19} /></span>
                <span className="instrument-name">{profiles[id].title}</span>
                <span className="instrument-family">{profiles[id].eyebrow}</span>
                {active === id && <span className="check">✓</span>}
              </button>
            ))}
          </div>

          <div className="editor-grid">
            <section className="panel synth-panel">
              <div className="panel-head"><div><span className="step">02</span><h3>{profile.title} mini-synth</h3></div><span className={`live-tag ${controlMode}`}><span /> {controlMode === 'auto' ? 'AUTO-TUNED' : controlMode === 'manual' ? 'MANUAL OVERRIDE' : 'DEFAULTS'}</span></div>
              <p className="panel-description">{profile.description}</p>
              <div className="waveform"><div className="wave-label">GENERATIVE SPECTRUM <span>never sample playback</span></div><div className="wave-bars">{Array.from({ length: 42 }, (_, i) => <i key={i} style={{ height: `${18 + ((i * 17 + seed) % 63)}%`, background: profile.color }} />)}</div><div className="wave-time"><span>seed {String(seed).padStart(3, '0')}</span><span>{performance ? `${performance.duration.toFixed(1)}s · ${performance.architecture}` : 'new performance ready'}</span><button className="preview-btn" onClick={previewGenerated} disabled={generating} aria-label="Generate WAV performance"><Play size={10} fill="currentColor" /> {generating ? 'rendering' : 'generate'}</button></div></div>
              {renderError && <div className="render-error" role="alert"><XCircle size={14} /><span>{renderError}</span></div>}
              <div className="performance-tools"><label>Performance seed <input type="number" min="0" max="9999" value={seed} onChange={(event) => setSeed(Number(event.target.value) || 0)} /></label>{performance && <a className="download-link" href={performance.url} download={`${active}-performance-${performance.seed}.wav`}><Download size={13} /> save WAV</a>}</div>
              <div className="control-grid">{profile.controls.map((control) => { const value = controls[control.label] ?? Number.parseInt(control.value, 10); return <div className="control" key={control.label}><div className="control-label"><span>{control.label}</span><b>{value}%</b></div><input className="range" type="range" min="0" max="100" value={value} aria-label={control.label} onChange={(event) => updateControl(control.label, Number(event.target.value))} style={{ accentColor: profile.color }} /><small>{control.detail} · conditions the generated model</small></div>; })}</div>
              <div className={`adjustment-note ${controlMode}`}><Sparkles size={13} /><span>{controlMode === 'auto' ? `Auto-adjusted from ${assets.filter((asset) => asset.features).length} accepted reference layer${assets.filter((asset) => asset.features).length === 1 ? '' : 's'}. Sliders remain editable.` : controlMode === 'manual' ? 'Manual changes are active. Add accepted layers to recalculate from the full reference set.' : 'Using this instrument’s default synthesis profile.'}</span><button className="text-btn" onClick={resetControlsToDefaults}>Reset defaults</button></div>
               <div className="live-instrument" style={{ '--instrument-color': profile.color } as React.CSSProperties}>
                 <div className="live-instrument-head"><div><span className="step">LIVE INPUT</span><h4>Play the generated instrument</h4></div><span className={`midi-status ${midiStatus}`}><Mic2 size={12} /> MIDI {midiStatus}</span></div>
                 <p>Use your computer keyboard or MIDI controller. Seed {seed} and articulation controls shape every live voice.</p>
                 <div className="keybed" aria-label="Computer keyboard instrument">
                   {(['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'] as const).map((key, index) => {
                     const note = COMPUTER_KEYS[key];
                     return <button key={key} className={`key ${index === 1 || index === 3 || index === 6 || index === 8 || index === 10 ? 'black-key' : ''} ${liveNote === note ? 'pressed' : ''}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startLiveNote(note, 0.82); }} onPointerUp={() => stopLiveNote(note)} onPointerCancel={() => stopLiveNote(note)}>{key.toUpperCase()}</button>;
                   })}
                 </div>
                 <div className="live-caption"><KeyboardMusic size={13} /> computer keys A–K · MIDI input {midiStatus === 'connected' ? 'ready' : midiStatus === 'waiting' ? 'searching' : 'not available'}</div>
               </div>
              <div className="synth-footer"><span><SlidersHorizontal size={15} /> {profile.architecture}</span><button className="text-btn" onClick={() => setSeed(Math.floor(Math.random() * 10000))}><Plus size={14} /> new seed</button></div>
            </section>

            <section className="panel assets-panel">
              <div className="panel-head"><div><span className="step">03</span><h3>Source layers</h3></div><div className="asset-actions"><span className="asset-count">{assets.length} attached</span><label className="upload-btn" htmlFor="aim-sample-files"><Upload size={13} /> Upload samples</label><label className="upload-btn" htmlFor="aim-sample-folder"><FolderOpen size={13} /> Add a folder</label></div></div>
              <p className="panel-description">Add folders of OGG takes. Each folder is added to the same curation batch. Use the folder chooser repeatedly, or drag several folders together onto the drop area.</p>
              <input id="aim-sample-files" ref={fileRef} className="file-picker-input" type="file" accept=".ogg,audio/ogg" multiple onChange={async (event) => { const input = event.currentTarget; await addFiles(input.files); input.value = ''; }} />
              <input id="aim-sample-folder" ref={folderRef} className="file-picker-input" type="file" accept=".ogg,audio/ogg" multiple onChange={async (event) => { const input = event.currentTarget; await addFiles(input.files); input.value = ''; }} {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} />
              <label className="dropzone" htmlFor="aim-sample-folder" onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }} onDrop={async (event) => { event.preventDefault(); try { const files = event.dataTransfer.items?.length ? await collectDroppedFiles(event.dataTransfer.items) : Array.from(event.dataTransfer.files); await addFiles(files); } catch { setUploadError('Those folders could not be read. Try the Add a folder button or drop the OGG files directly.'); } }}>
                <span className="upload-icon"><FolderOpen size={18} /></span><b>Drop multiple sample folders here</b><span>multi-folder drop supported · picker selections merge · OGG files only</span>
              </label>
              {uploadError && <div className="upload-error" role="alert"><AlertCircle size={14} /> {uploadError}</div>}
              {sampleCandidates.length > 0 && candidateInstrument === active && <div className="curation-panel"><div className="curation-head"><div><span className="inspector-label">AIM SAMPLE CURATION · {sampleCandidates.filter((candidate) => candidate.selected).length} OF {sampleCandidates.length} PRESELECTED</span><p>Ranked for {profile.title} by level, tone, transient, and useful length.</p></div><div><label className="text-btn" htmlFor="aim-sample-folder"><FolderOpen size={13} /> add another folder</label><button className="text-btn" onClick={() => setSampleCandidates((current) => current.map((candidate) => ({ ...candidate, selected: true })))}>select all</button><button className="primary-btn" onClick={acceptCandidates}><CheckCircle2 size={14} /> Add selected</button></div></div><div className="candidate-list">{sampleCandidates.map((candidate) => <label className={`candidate-row ${candidate.selected ? 'chosen' : ''}`} key={`${candidate.sourcePath}-${candidate.name}`}><input type="checkbox" checked={Boolean(candidate.selected)} onChange={() => toggleCandidate(candidate.sourcePath ?? candidate.name)} /><span className="candidate-name"><b>{candidate.name}</b><small>{candidate.sourcePath}</small></span><span className="candidate-score">{candidate.score ?? 0}<small>score</small></span></label>)}</div></div>}
              <div className="asset-list">{assets.length === 0 ? <div className="empty-assets"><span>♪</span><p>No layers yet</p><small>OGG keeps AIM packages compact and streamable.</small></div> : assets.map((asset) => <div className="asset-row" key={`${asset.name}-${asset.size}`}><span className="play"><Waves size={12} /></span><div><b>{asset.name}</b><small>analyzed · timbre {Math.round((asset.features?.brightness ?? 0) * 100)}% · fingerprint {asset.features?.fingerprint ?? 'pending'}</small></div><span className="asset-size">{asset.size}</span></div>)}</div>
              <div className="package-meta"><span>PACKAGE SIZE</span><b>{formatBytes(packageSize)}</b><span className="meta-spacer" /><span>ROLE</span><b>REFERENCE ONLY</b></div>
            </section>
          </div>
          <footer className="footer-note"><span><Sparkles size={14} /> AIM maps sound into portable synthesis rules.</span><span>Procedural instrument · {profile.title}</span></footer></>}
        </div>
      </section>
    </main>
  );
}

function SessionControls() {
  const { signOut } = useClerk();
  const { user } = useUser();
  return <button className="ghost-btn sign-out-btn" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={15} /> {user?.firstName ? `Sign out ${user.firstName}` : 'Sign out'}</button>;
}

function money(amount: number | null, currency: string) {
  if (amount === null) return 'Contact us';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 0 }).format(amount / 100);
}

function CommercePanel({ access, onRefresh, onDownloadPackages }: { access: CommerceAccess; onRefresh: () => Promise<void>; onDownloadPackages: (instruments: InstrumentId[], license: 'personal' | 'commercial') => Promise<void> }) {
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    apiJson<{ products: CommerceProduct[] }>('/api/commerce/catalog')
      .then((result) => { if (live) setProducts(result.products); })
      .catch((error) => { if (live) setCatalogError(error instanceof Error ? error.message : 'The storefront is unavailable.'); });
    return () => { live = false; };
  }, []);

  async function checkout(priceId: string) {
    setBusy(priceId);
    setCatalogError(null);
    try {
      const result = await apiJson<{ url: string }>('/api/commerce/checkout', { method: 'POST', body: JSON.stringify({ priceId }) });
      window.location.assign(result.url);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Checkout could not be started.');
      setBusy(null);
    }
  }

  async function manageBilling() {
    setBusy('portal');
    try {
      const result = await apiJson<{ url: string }>('/api/commerce/portal', { method: 'POST' });
      window.location.assign(result.url);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Billing management could not be opened.');
      setBusy(null);
    }
  }

  async function cancelStudio() {
    if (!window.confirm('Cancel Studio at the end of the current billing period?')) return;
    setBusy('cancel');
    try {
      await apiJson('/api/commerce/subscription/cancel', { method: 'POST' });
      await onRefresh();
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Studio could not be cancelled.');
    } finally {
      setBusy(null);
    }
  }

  async function downloadLicensedPackages() {
    setBusy('download');
    setCatalogError(null);
    try {
      await onDownloadPackages(licensedInstruments, access.entitlements.commercialSdk ? 'commercial' : 'personal');
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Your package access could not be verified.');
    } finally {
      setBusy(null);
    }
  }

  const licensedInstruments = access.entitlements.commercialSdk ? order : access.entitlements.instruments;
  const instrumentProducts = products.filter((product) => product.kind === 'instrument' || product.kind === 'commercial-sdk');
  const studioProduct = products.find((product) => product.kind === 'studio');

  return <section id="aim-store" className="commerce-panel">
    <div className="commerce-heading"><div><p className="kicker">AIM STORE</p><h2>Own the instruments.<br /><em>Subscribe to the studio.</em></h2><p>Instrument packages include their personal-use SDKs. Studio generation is a separate recurring membership.</p></div><div className={`commerce-status ${access.studioActive ? 'active' : ''}`}><span className="pulse" /><b>{access.studioActive ? 'Studio active' : 'Studio not subscribed'}</b>{access.subscription?.cancelAtPeriodEnd && <small>Ends {new Date(access.subscription.currentPeriodEnd).toLocaleDateString()}</small>}</div></div>
    {access.billingUnavailable && <div className="commerce-error"><AlertCircle size={15} /> Billing is being configured. The private owner workbench remains available, but checkout is temporarily offline.</div>}
    {catalogError && <div className="commerce-error"><AlertCircle size={15} /> {catalogError}</div>}
    <div className="commerce-grid">
      <div className="commerce-section"><div className="commerce-label">INSTRUMENTS & SDK</div><div className="offer-list">{instrumentProducts.map((product) => {
        const owned = product.entitlement === 'commercial-sdk:all' ? access.entitlements.commercialSdk : product.entitlement === 'instrument:all' ? access.entitlements.instruments.length === order.length : product.instrumentId ? access.entitlements.instruments.includes(product.instrumentId) : false;
        return <article className={`offer-card ${owned ? 'owned' : ''}`} key={product.id}><div><b>{product.name}</b><p>{product.description}</p></div><div className="offer-actions">{product.prices.map((price) => <button className={owned ? 'ghost-btn' : 'primary-btn'} key={price.id} disabled={owned || busy === price.id || access.billingUnavailable} onClick={() => void checkout(price.id)}>{owned ? 'Owned' : busy === price.id ? 'Opening checkout…' : `${money(price.amount, price.currency)} · Buy`}</button>)}</div></article>;
      })}</div></div>
      <div className="commerce-section studio-offer"><div className="commerce-label">AIM MUSIC STUDIO</div>{studioProduct ? <article className="offer-card featured"><div><b>{studioProduct.name}</b><p>{studioProduct.description}</p></div><div className="offer-actions">{access.studioActive ? <><button className="ghost-btn" disabled={busy === 'portal' || access.billingUnavailable} onClick={() => void manageBilling()}>Manage billing</button><button className="text-btn danger" disabled={busy === 'cancel' || access.subscription?.cancelAtPeriodEnd} onClick={() => void cancelStudio()}>{access.subscription?.cancelAtPeriodEnd ? 'Cancellation scheduled' : 'Cancel subscription'}</button></> : studioProduct.prices.map((price) => <button className="primary-btn" key={price.id} disabled={busy === price.id || access.billingUnavailable} onClick={() => void checkout(price.id)}>{busy === price.id ? 'Opening checkout…' : `${money(price.amount, price.currency)}${price.interval === 'year' ? ' / year' : ' / month'}`}</button>)}</div></article> : <p className="empty-library">Loading Studio plans…</p>}</div>
    </div>
    {licensedInstruments.length > 0 && <div className="license-strip"><div><b>Your licensed AIM packages</b><p>{access.entitlements.commercialSdk ? 'Commercial all-instrument SDK license' : `${licensedInstruments.length} personal-use instrument package${licensedInstruments.length === 1 ? '' : 's'}`}</p></div><button className="ghost-btn" disabled={busy === 'download'} onClick={() => void downloadLicensedPackages()}><PackageOpen size={15} /> {busy === 'download' ? 'Verifying license…' : 'Download licensed packages'}</button></div>}
  </section>;
}

function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const signInPath = `${basePath}/sign-in`;
  const signUpPath = `${basePath}/sign-up`;
  return <main className="auth-shell"><div className="auth-brand"><div className="brand-mark"><Waves size={24} /></div><strong>AIM Music</strong><span>Procedural performance studio</span></div><div className="auth-card">{mode === 'sign-in' ? <SignIn routing="path" path={signInPath} signUpUrl={signUpPath} /> : <SignUp routing="path" path={signUpPath} signInUrl={signInPath} />}</div></main>;
}

function PublicLanding() {
  return <main className="auth-shell"><section className="public-landing"><div className="auth-brand"><div className="brand-mark"><Waves size={24} /></div><strong>AIM Music</strong><span>Procedural performance studio</span></div><p className="kicker">MUSIC GENERATION, REIMAGINED</p><h1>Build the song.<br /><em>Keep the performance moving.</em></h1><p>Purchase an AIM instrument package with its personal-use SDK for $39, all seven for $179, or a commercial all-instrument SDK license for $499. AIM Music Studio is $29/month or $249/year.</p><div className="public-actions"><a className="primary-btn" href={`${basePath}/sign-up`}>Create account & view checkout</a><a className="ghost-btn" href={`${basePath}/sign-in`}>Sign in</a></div><small>Creating an account does not complete a purchase. The private AIM instrument builder remains owner-only.</small></section></main>;
}

function OwnerGate() {
  const [access, setAccess] = useState<{ isOwner: boolean } | null>(null);
  const [commerceAccess, setCommerceAccess] = useState<CommerceAccess>({ studioActive: false, entitlements: { instruments: [], sdks: [], commercialSdk: false }, subscription: null });

  async function refreshCommerce() {
    try {
      const result = await apiJson<CommerceAccess>('/api/commerce/access');
      setCommerceAccess(result);
    } catch {
      setCommerceAccess({ studioActive: false, entitlements: { instruments: [], sdks: [], commercialSdk: false }, subscription: null, billingUnavailable: true });
    }
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/owner-access', { credentials: 'include', cache: 'no-store' });
        const result = await response.json().catch(() => ({})) as { isOwner?: boolean };
        if (active) setAccess({ isOwner: response.ok && Boolean(result.isOwner) });
      } catch {
        if (active) setAccess({ isOwner: false });
      }
      await refreshCommerce();
    };
    void load();
    return () => { active = false; };
  }, []);

  if (access === null) {
    return <main className="auth-shell"><div className="access-check"><span className="pulse" /> Checking studio access…</div></main>;
  }
  return <InstrumentLab showCreator={access.isOwner} commerceAccess={commerceAccess} onRefreshCommerce={refreshCommerce} />;
}

function AccessRouter() {
  const { isLoaded, isSignedIn } = useUser();
  const path = window.location.pathname;

  if (path === `${basePath}/sign-in` || path.startsWith(`${basePath}/sign-in/`)) return <AuthScreen mode="sign-in" />;
  if (path === `${basePath}/sign-up` || path.startsWith(`${basePath}/sign-up/`)) return <AuthScreen mode="sign-up" />;
  if (!isLoaded) return <main className="auth-shell"><div className="access-check"><span className="pulse" /> Loading AIM Music…</div></main>;
  return isSignedIn ? <OwnerGate /> : <PublicLanding />;
}

function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY.');
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}><AccessRouter /></ClerkProvider>;
}

export default App;

async function generatePerformance(instrument: InstrumentId, controls: Record<string, number>, assets: Asset[], seed: number, renderDuration = 5.2, intensity = 1, space = 0) {
  const sampleRate = 44100;
  const duration = renderDuration;
  const offline = new OfflineAudioContext(1, Math.ceil(sampleRate * duration), sampleRate);
  const master = offline.createGain();
  const reference = assets.reduce((sum, asset) => sum + (asset.features?.brightness ?? 0.5), 0) / Math.max(1, assets.length);
  const controlValues = profiles[instrument].controls.map((control) => controls[control.label] ?? Number.parseInt(control.value, 10));
  const articulation = controlValues.reduce((sum, value) => sum + value, 0) / controlValues.length / 100;
  const random = seededRandom(seed);
  const base: Record<InstrumentId, number> = { 'acoustic-guitar': 196, 'bass-guitar': 98, 'electric-guitar': 220, 'pedal-steel': 247, fiddle: 294, keyboard: 330, vocal: 262 };
  const architecture = profiles[instrument].architecture;
  master.gain.value = 0.42 * intensity;
  master.connect(offline.destination);
  if (space > 0) {
    const reflection = offline.createDelay(0.45);
    const reflectionGain = offline.createGain();
    reflection.delayTime.value = 0.045 + space / 1000;
    reflectionGain.gain.value = (space / 100) * 0.18;
    master.connect(reflection).connect(reflectionGain).connect(offline.destination);
  }
  const addVoice = (frequency: number, start: number, length: number, velocity: number) => {
    const osc = offline.createOscillator();
    const gain = offline.createGain();
    const body = offline.createBiquadFilter();
    body.type = instrument === 'bass-guitar' ? 'lowpass' : instrument === 'vocal' ? 'bandpass' : 'lowpass';
    body.frequency.value = instrument === 'bass-guitar' ? 650 + articulation * 700 : 1800 + reference * 2200 + articulation * 1800;
    osc.type = instrument === 'keyboard' ? 'triangle' : instrument === 'vocal' ? 'sine' : instrument === 'electric-guitar' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(frequency, start);
    if (instrument === 'pedal-steel') osc.frequency.linearRampToValueAtTime(frequency * (1 + (random() - 0.45) * 0.035), start + 0.42);
    if (instrument === 'fiddle') osc.detune.setValueAtTime((random() - 0.5) * 14, start + 0.2);
    if (instrument === 'vocal') osc.frequency.linearRampToValueAtTime(frequency * 1.015, start + 0.55);
    const attack = instrument === 'pedal-steel' || instrument === 'vocal' ? 0.12 + (1 - articulation) * 0.18 : 0.008 + (1 - articulation) * 0.03;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(velocity * (0.13 + articulation * 0.09), start + attack);
    gain.gain.exponentialRampToValueAtTime(0.001, start + length * (0.75 + articulation * 0.3));
    osc.connect(body).connect(gain).connect(master);
    osc.start(start); osc.stop(Math.min(duration, start + length + 0.05));
    if (instrument === 'acoustic-guitar' || instrument === 'electric-guitar' || instrument === 'keyboard') {
      const overtone = offline.createOscillator();
      const overtoneGain = offline.createGain();
      overtone.type = 'sine'; overtone.frequency.value = frequency * 2.01;
      overtoneGain.gain.setValueAtTime(velocity * (instrument === 'keyboard' ? 0.045 : 0.07), start);
      overtoneGain.gain.exponentialRampToValueAtTime(0.001, start + length * 0.7);
      overtone.connect(overtoneGain).connect(master); overtone.start(start); overtone.stop(Math.min(duration, start + length));
    }
  };
  const phraseDuration = 4.55;
  for (let phrase = 0; phrase * phraseDuration < duration; phrase += 1) {
    createPerformancePlan(instrument, seed + phrase * 97).forEach((event) => {
      const start = event.start + phrase * phraseDuration;
      if (start < duration) addVoice(base[instrument] * 2 ** (event.note / 12), start, event.length, event.velocity);
    });
  }
  // A tiny synthesized breath/noise bed makes the instrument profiles perceptually distinct without using source playback.
  if (instrument === 'vocal' || instrument === 'fiddle') {
    const noise = offline.createBufferSource();
    const noiseBuffer = offline.createBuffer(1, sampleRate * duration, sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = random() * 2 - 1;
    noise.buffer = noiseBuffer;
    const noiseGain = offline.createGain(); noiseGain.gain.value = instrument === 'vocal' ? 0.012 : 0.008;
    noise.connect(noiseGain).connect(master); noise.start();
  }
  const rendered = await offline.startRendering();
  return { wav: encodeWav(rendered), samples: rendered.getChannelData(0).slice(), duration, architecture, seed };
}

async function renderStudioArrangement(
  arrangement: ArrangementSection[],
  song: SongInput,
  mix: Record<string, MusicianMix>,
  assetBank: Record<InstrumentId, Asset[]>,
  controlBank: ControlBank,
  seed: number,
): Promise<StudioRender> {
  const plannedDuration = arrangement.at(-1) ? arrangement.at(-1)!.start + arrangement.at(-1)!.duration : 30;
  const duration = Math.max(12, Math.min(32, plannedDuration));
  const soloed = order.filter((instrument) => mix[instrument].solo);
  const activeInstruments = soloed.length ? soloed : order.filter((instrument) => !mix[instrument].muted);
  const renderables = await Promise.all(activeInstruments.map(async (instrument, index) => {
    const performer = mix[instrument];
    const modelControls = controlBank[instrument] ?? defaultControlsFor(instrument);
    const controlValues = Object.fromEntries(profiles[instrument].controls.map((control) => [
      control.label,
      Math.min(100, Math.max(0, (modelControls[control.label] ?? Number.parseInt(control.value, 10)) + (performer.intensity - 58) * 0.2)),
    ]));
    const stem = await generatePerformance(
      instrument,
      controlValues,
      assetBank[instrument],
      seed + (index + 1) * 161,
      duration,
      performer.level / 100,
      performer.space,
    );
    return { instrument, stem, level: performer.level / 100 };
  }));
  const master = new Float32Array(Math.ceil(44100 * duration));
  const stems: StudioRender['stems'] = {};
  renderables.forEach(({ instrument, stem }) => {
    for (let index = 0; index < master.length; index += 1) master[index] += stem.samples[index] ?? 0;
    stems[instrument] = { url: URL.createObjectURL(new Blob([stem.wav], { type: 'audio/wav' })), bytes: stem.wav };
  });
  for (let index = 0; index < master.length; index += 1) master[index] = Math.tanh(master[index] * 0.78);
  const masterWav = encodeWav({ length: master.length, sampleRate: 44100, getChannelData: () => master });
  return { duration, master: { url: URL.createObjectURL(new Blob([masterWav], { type: 'audio/wav' })), bytes: masterWav }, stems };
}

function fileSafe(value: string) {
  return (value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'aim-song');
}

function downloadText(content: string, name: string, type: string) {
  downloadBytes(new TextEncoder().encode(content), name, type);
}

function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function analyzeReference(bytes: Uint8Array): Promise<LearnedFeatures> {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('Audio analysis is unavailable in this browser.');
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(bytes.slice().buffer);
    return extractFeatures(buffer.getChannelData(0), buffer.sampleRate);
  } finally {
    await context.close();
  }
}

type SavedPackage = Omit<GenerationInstrument, 'bytes' | 'sdkBytes' | 'savedAt'> & { instrumentId: InstrumentId; updatedAt: string; savedAt: string };

type SavedReference = {
  instrumentId: InstrumentId;
  objectPath: string;
  metadata: Omit<Asset, 'bytes' | 'url' | 'objectPath' | 'score' | 'selected'>;
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, ...init });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error ?? `Could not save to your library (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

async function uploadPrivateBytes(bytes: Uint8Array, name: string, contentType: string) {
  const signed = await apiJson<{ uploadURL: string; objectPath: string }>('/api/storage/uploads/request-url', {
    method: 'POST',
    body: JSON.stringify({ name, size: bytes.length, contentType }),
  });
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Blob([payload]) });
  if (!result.ok) throw new Error(`Could not upload ${name}.`);
  return signed.objectPath;
}

type SavedSongProject = {
  id: string;
  title: string;
  song: SongInput;
  arrangement: ArrangementSection[];
  lyricCues: LyricCue[];
  musicianMix: Record<string, MusicianMix>;
  assets: Record<InstrumentId, Array<Omit<Asset, 'bytes' | 'url'>>>;
  renderHistory: SavedRender[];
  updatedAt: string;
};
