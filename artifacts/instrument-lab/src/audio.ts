export type AudioInstrument = 'acoustic-guitar' | 'bass-guitar' | 'electric-guitar' | 'pedal-steel' | 'fiddle' | 'keyboard' | 'vocal';

export type LearnedFeatures = {
  rms: number;
  brightness: number;
  transient: number;
  duration: number;
  fingerprint: string;
};

export type PerformanceEvent = {
  start: number;
  note: number;
  velocity: number;
  length: number;
};

export function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** The phrase scheduler is deliberately pure so seeded renders can be regression-tested. */
export function createPerformancePlan(instrument: AudioInstrument, seed: number): PerformanceEvent[] {
  const random = seededRandom(seed);
  const scale = [0, 3, 5, 7, 10, 12, 14, 17];
  const count = instrument === 'keyboard' ? 12 : 10;
  return Array.from({ length: count }, (_, index) => ({
    start: 0.15 + index * 0.43 + random() * 0.08,
    note: scale[Math.floor(random() * scale.length)] + (index % 4 === 0 ? 12 : 0),
    velocity: 0.58 + random() * 0.35,
    length: instrument === 'bass-guitar' ? 0.72 : 0.54 + random() * 0.35,
  }));
}

export function encodeWav(buffer: Pick<AudioBuffer, 'length' | 'sampleRate' | 'getChannelData'>) {
  const channels = 1;
  const dataLength = buffer.length * channels * 2;
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  const write = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + dataLength, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataLength, true);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(output);
}

export function extractFeatures(samples: ArrayLike<number>, sampleRate: number): LearnedFeatures {
  const stride = Math.max(1, Math.floor(samples.length / 16000));
  let energy = 0;
  let high = 0;
  let transient = 0;
  let previous = 0;
  for (let i = 0; i < samples.length; i += stride) {
    const sample = samples[i];
    energy += sample * sample;
    high += Math.abs(sample - previous);
    transient = Math.max(transient, Math.abs(sample - previous));
    previous = sample;
  }
  const count = Math.ceil(samples.length / stride);
  const rms = Math.min(1, Math.sqrt(energy / count) * 3);
  const brightness = Math.min(1, (high / count) * 5);
  const duration = samples.length / sampleRate;
  const fingerprint = [rms, brightness, transient, duration].map((value) => value.toFixed(4)).join('-');
  return { rms, brightness, transient: Math.min(1, transient * 4), duration, fingerprint };
}

export const AIM_OUTPUT_POLICY = 'new-performance';
export const AIM_REFERENCE_ROLE = 'timbre-reference';

export function isReferenceOnlyOutput(metadata: { engine?: { mode?: string; outputPolicy?: string }; assets?: Array<{ role?: string }> }) {
  return metadata.engine?.mode === 'procedural-instrument'
    && metadata.engine.outputPolicy === AIM_OUTPUT_POLICY
    && Boolean(metadata.assets?.length === 0 || metadata.assets?.every((asset) => asset.role === AIM_REFERENCE_ROLE));
}