import type { LearnedFeatures } from './audio';

export type CuratableLayer = {
  name: string;
  features?: LearnedFeatures;
  sourcePath?: string;
  selected?: boolean;
  score?: number;
};

type CuratableInstrument = 'acoustic-guitar' | 'bass-guitar' | 'electric-guitar' | 'pedal-steel' | 'fiddle' | 'keyboard' | 'vocal';

const targetBrightness: Record<CuratableInstrument, number> = {
  'acoustic-guitar': 0.46,
  'bass-guitar': 0.2,
  'electric-guitar': 0.62,
  'pedal-steel': 0.58,
  fiddle: 0.7,
  keyboard: 0.5,
  vocal: 0.56,
};

export function scoreReferenceLayer(instrument: CuratableInstrument, features?: LearnedFeatures) {
  if (!features) return 0;
  const loudness = 1 - Math.min(1, Math.abs(features.rms - 0.42) / 0.42);
  const brightness = 1 - Math.min(1, Math.abs(features.brightness - targetBrightness[instrument]) / 0.8);
  const transient = instrument === 'vocal' || instrument === 'pedal-steel'
    ? 1 - Math.min(1, Math.abs(features.transient - 0.3) / 0.7)
    : features.transient;
  const usefulLength = features.duration >= 0.12 && features.duration <= 12 ? 1 : 0.35;
  return Math.round((loudness * 0.35 + brightness * 0.3 + transient * 0.2 + usefulLength * 0.15) * 100);
}

export function rankReferenceLayers<T extends CuratableLayer>(instrument: CuratableInstrument, layers: T[], maxSelected = 8) {
  return layers
    .map((layer) => ({ ...layer, score: scoreReferenceLayer(instrument, layer.features) }))
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .map((layer, index) => ({ ...layer, selected: index < maxSelected }));
}