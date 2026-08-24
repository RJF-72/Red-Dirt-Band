import assert from 'node:assert/strict';
import test from 'node:test';
import { rankReferenceLayers, scoreReferenceLayer } from './sample-curation';
import { deriveSampleAdjustedControls, profileDefaultControls, shouldApplySampleAdjustment } from './sample-adjustment';

const balancedGuitar = { rms: 0.42, brightness: 0.46, transient: 0.72, duration: 2.4, fingerprint: 'balanced' };
const unusableLayer = { rms: 0.02, brightness: 1, transient: 0, duration: 0.02, fingerprint: 'unusable' };

test('ranks usable acoustic references ahead of unusable ones', () => {
  const ranked = rankReferenceLayers('acoustic-guitar', [
    { name: 'quiet-fragment.ogg', features: unusableLayer },
    { name: 'balanced-pick.ogg', features: balancedGuitar },
  ]);
  assert.equal(ranked[0].name, 'balanced-pick.ogg');
  assert.equal(ranked[0].selected, true);
  assert.ok((ranked[0].score ?? 0) > (ranked[1].score ?? 0));
});

test('preselects only the configured number of strongest reference layers', () => {
  const layers = Array.from({ length: 10 }, (_, index) => ({ name: `take-${index}.ogg`, features: { ...balancedGuitar, rms: 0.42 - index * 0.005 } }));
  const ranked = rankReferenceLayers('acoustic-guitar', layers, 4);
  assert.equal(ranked.filter((layer) => layer.selected).length, 4);
  assert.ok(scoreReferenceLayer('acoustic-guitar', balancedGuitar) > scoreReferenceLayer('acoustic-guitar', unusableLayer));
});

const bassControls = [
  { label: 'Cabinet weight', defaultValue: 62 },
  { label: 'Pluck attack', defaultValue: 55 },
  { label: 'Sub sustain', defaultValue: 78 },
  { label: 'Fret texture', defaultValue: 18 },
];

test('returns profile defaults without usable reference features', () => {
  const adjustment = deriveSampleAdjustedControls('bass-guitar', bassControls, [undefined]);

  assert.equal(adjustment.adjusted, false);
  assert.equal(adjustment.layerCount, 0);
  assert.deepEqual(adjustment.controls, profileDefaultControls(bassControls));
});

test('maps aggregated bass features to the bass synthesis vocabulary', () => {
  const adjustment = deriveSampleAdjustedControls('bass-guitar', bassControls, [
    { rms: 0.95, brightness: 0.2, transient: 0.9, duration: 5.5 },
    { rms: 0.85, brightness: 0.18, transient: 0.8, duration: 4.8 },
  ]);

  assert.equal(adjustment.adjusted, true);
  assert.equal(adjustment.layerCount, 2);
  assert.deepEqual(Object.keys(adjustment.controls), bassControls.map((control) => control.label));
  assert.ok(adjustment.controls['Cabinet weight'] > 62, 'low, strong layers should add cabinet weight');
  assert.ok(adjustment.controls['Pluck attack'] > 55, 'clear transient layers should add pluck attack');
  assert.ok(adjustment.controls['Sub sustain'] > 78, 'long layers should add sub sustain');
  assert.ok(adjustment.controls['Fret texture'] > 18, 'transient layers should add fret texture');
});

test('keeps sample adjustments bounded for extreme values and distinct profiles', () => {
  const acousticControls = [
    { label: 'Body resonance', defaultValue: 68 },
    { label: 'Pick definition', defaultValue: 74 },
    { label: 'Finger noise', defaultValue: 21 },
    { label: 'String damping', defaultValue: 42 },
  ];
  const extreme = { rms: 4, brightness: -2, transient: 8, duration: 80 };
  const bass = deriveSampleAdjustedControls('bass-guitar', bassControls, [extreme]);
  const acoustic = deriveSampleAdjustedControls('acoustic-guitar', acousticControls, [extreme]);

  Object.values(bass.controls).concat(Object.values(acoustic.controls)).forEach((value) => {
    assert.ok(value >= 0 && value <= 100);
  });
  assert.deepEqual(Object.keys(acoustic.controls), acousticControls.map((control) => control.label));
  assert.notDeepEqual(bass.controls, acoustic.controls);
});

test('preserves manual or reset choices during refresh while accepted layers force a new adjustment', () => {
  assert.equal(shouldApplySampleAdjustment(false), true, 'first hydration may apply a recommendation');
  assert.equal(shouldApplySampleAdjustment(true), false, 'refresh must preserve an explicit user choice');
  assert.equal(shouldApplySampleAdjustment(true, true), true, 'accepted layers intentionally recalculate the instrument');
});