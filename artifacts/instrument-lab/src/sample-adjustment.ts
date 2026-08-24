import type { AudioInstrument, LearnedFeatures } from './audio';

export type InstrumentControl = {
  label: string;
  defaultValue: number;
};

export type SampleAdjustment = {
  controls: Record<string, number>;
  adjusted: boolean;
  layerCount: number;
};

type AggregateFeatures = {
  level: number;
  brightness: number;
  transient: number;
  sustain: number;
};

const clamp = (value: number) => Math.round(Math.min(100, Math.max(0, value)));
const unit = (value: number) => Math.min(1, Math.max(0, value));

export function profileDefaultControls(definitions: InstrumentControl[]) {
  return Object.fromEntries(definitions.map((control) => [control.label, clamp(control.defaultValue)]));
}

export function shouldApplySampleAdjustment(hasUserSelection: boolean, force = false) {
  return force || !hasUserSelection;
}

export function deriveSampleAdjustedControls(
  instrument: AudioInstrument,
  definitions: InstrumentControl[],
  layers: Array<Pick<LearnedFeatures, 'rms' | 'brightness' | 'transient' | 'duration'> | undefined>,
): SampleAdjustment {
  const defaults = profileDefaultControls(definitions);
  const usable = layers.filter((layer): layer is Pick<LearnedFeatures, 'rms' | 'brightness' | 'transient' | 'duration'> => (
    layer !== undefined
    && Number.isFinite(layer.rms)
    && Number.isFinite(layer.brightness)
    && Number.isFinite(layer.transient)
    && Number.isFinite(layer.duration)
  ));
  if (!usable.length) return { controls: defaults, adjusted: false, layerCount: 0 };

  const features: AggregateFeatures = {
    level: average(usable.map((layer) => unit(layer.rms))),
    brightness: average(usable.map((layer) => unit(layer.brightness))),
    transient: average(usable.map((layer) => unit(layer.transient))),
    // Reference recordings beyond six seconds should not continue increasing sustain.
    sustain: average(usable.map((layer) => unit((layer.duration - 0.08) / 5.92))),
  };
  const targets = instrumentTargets[instrument](features);

  return {
    adjusted: true,
    layerCount: usable.length,
    controls: Object.fromEntries(definitions.map((control, index) => {
      const target = targets[index] ?? control.defaultValue / 100;
      // Preserve the profile identity while allowing recordings to make a clear change.
      return [control.label, clamp(control.defaultValue * 0.45 + target * 100 * 0.55)];
    })),
  };
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

const instrumentTargets: Record<AudioInstrument, (features: AggregateFeatures) => number[]> = {
  'acoustic-guitar': ({ level, brightness, transient, sustain }) => [
    level * 0.46 + (1 - brightness) * 0.26 + sustain * 0.28,
    brightness * 0.44 + transient * 0.56,
    transient * 0.72 + brightness * 0.28,
    (1 - sustain) * 0.72 + (1 - transient) * 0.28,
  ],
  'bass-guitar': ({ level, brightness, transient, sustain }) => [
    level * 0.5 + (1 - brightness) * 0.3 + sustain * 0.2,
    transient * 0.66 + brightness * 0.34,
    sustain * 0.66 + (1 - brightness) * 0.34,
    transient * 0.58 + brightness * 0.42,
  ],
  'electric-guitar': ({ level, brightness, transient, sustain }) => [
    level * 0.36 + brightness * 0.32 + sustain * 0.32,
    brightness * 0.58 + transient * 0.42,
    sustain * 0.7 + level * 0.3,
    transient * 0.45 + sustain * 0.55,
  ],
  'pedal-steel': ({ brightness, transient, sustain }) => [
    sustain * 0.72 + (1 - transient) * 0.28,
    sustain * 0.55 + (1 - transient) * 0.45,
    brightness * 0.64 + sustain * 0.36,
    sustain * 0.58 + (1 - transient) * 0.42,
  ],
  fiddle: ({ level, brightness, transient, sustain }) => [
    level * 0.48 + transient * 0.52,
    sustain * 0.52 + brightness * 0.48,
    transient * 0.55 + brightness * 0.45,
    sustain * 0.62 + (1 - transient) * 0.38,
  ],
  keyboard: ({ level, brightness, transient, sustain }) => [
    level * 0.42 + transient * 0.58,
    brightness * 0.7 + transient * 0.3,
    sustain * 0.74 + level * 0.26,
    brightness * 0.46 + sustain * 0.54,
  ],
  vocal: ({ level, brightness, transient, sustain }) => [
    (1 - transient) * 0.62 + (1 - brightness) * 0.38,
    brightness * 0.72 + level * 0.28,
    transient * 0.64 + brightness * 0.36,
    sustain * 0.58 + level * 0.42,
  ],
};