import assert from 'node:assert/strict';
import test from 'node:test';
import { createPerformancePlan, encodeWav, extractFeatures, isReferenceOnlyOutput } from './audio';
import { getVerifiedAimDownload, parseAimFile } from './aimf';

test('same instrument seed produces the same performance plan', () => {
  assert.deepEqual(createPerformancePlan('acoustic-guitar', 14), createPerformancePlan('acoustic-guitar', 14));
});

test('different seeds produce different performance plans', () => {
  assert.notDeepEqual(createPerformancePlan('acoustic-guitar', 14), createPerformancePlan('acoustic-guitar', 15));
});

test('encodes a valid PCM WAV with non-empty audio data', () => {
  const samples = Float32Array.from([0, 0.25, -0.5, 1]);
  const wav = encodeWav({ length: samples.length, sampleRate: 44100, getChannelData: () => samples });
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const text = (offset: number, length: number) => new TextDecoder().decode(wav.subarray(offset, offset + length));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(12, 4), 'fmt ');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), samples.length * 2);
  assert.ok(wav.subarray(44).some((byte) => byte !== 0), 'audio payload should not be silent');
});

test('extracts bounded feature metadata and a stable fingerprint', () => {
  const features = extractFeatures(Float32Array.from([0, 0.5, -0.5, 0.25]), 4);
  assert.deepEqual(features, {
    rms: 1,
    brightness: 1,
    transient: 1,
    duration: 1,
    fingerprint: '1.0000-1.0000-1.0000-1.0000',
  });
});

test('requires procedural new-performance output and reference-only assets', () => {
  assert.equal(isReferenceOnlyOutput({
    engine: { mode: 'procedural-instrument', outputPolicy: 'new-performance' },
    assets: [{ role: 'timbre-reference' }, { role: 'timbre-reference' }],
  }), true);
  assert.equal(isReferenceOnlyOutput({
    engine: { mode: 'sampler', outputPolicy: 'source-playback' },
    assets: [{ role: 'timbre-reference' }],
  }), false);
  assert.equal(isReferenceOnlyOutput({
    engine: { mode: 'procedural-instrument', outputPolicy: 'new-performance' },
    assets: [{ role: 'playback' }],
  }), false);
});

function createAimFixture(fileName = 'field-recording.aim') {
  const metadata = new TextEncoder().encode(JSON.stringify({
    format: 'AIM',
    version: 1,
    assets: [{ name: 'layer.ogg', type: 'audio/ogg', role: 'timbre-reference', bytes: 7 }],
    unknownMetadata: { futureHostHint: 'keep this', values: [3, 1, 4] },
  }));
  const name = new TextEncoder().encode('layer.ogg');
  const payload = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0xff, 0x13]);
  const result = new Uint8Array(12 + metadata.length + 6 + name.length + payload.length);
  const view = new DataView(result.buffer);
  result.set([0x41, 0x49, 0x4d, 0x46], 0);
  view.setUint16(4, 1, true);
  view.setUint32(6, metadata.length, true);
  view.setUint16(10, 1, true);
  result.set(metadata, 12);
  let offset = 12 + metadata.length;
  view.setUint16(offset, name.length, true);
  view.setUint32(offset + 2, payload.length, true);
  offset += 6;
  result.set(name, offset);
  result.set(payload, offset + name.length);
  return { fileName, bytes: result, payload };
}

test('inspection preserves unknown metadata and arbitrary OGG payload bytes', () => {
  const fixture = createAimFixture();
  const inspected = parseAimFile(fixture.fileName, fixture.bytes);

  assert.deepEqual(inspected.bytes, fixture.bytes);
  assert.deepEqual(inspected.metadata.unknownMetadata, { futureHostHint: 'keep this', values: [3, 1, 4] });
  assert.deepEqual(inspected.layers, [{ name: 'layer.ogg', bytes: fixture.payload.length }]);
});

test('verified re-save emits the exact inspected bytes with a clear filename', () => {
  const fixture = createAimFixture('my-instrument.AIM');
  const inspected = parseAimFile(fixture.fileName, fixture.bytes);
  const download = getVerifiedAimDownload(inspected);

  assert.equal(download.fileName, 'my-instrument-verified.aim');
  assert.deepEqual(download.bytes, fixture.bytes);
  assert.notStrictEqual(download.bytes, fixture.bytes);
});

test('verified re-save uses instrument as the fallback filename', () => {
  const fixture = createAimFixture('');
  const inspected = parseAimFile(fixture.fileName, fixture.bytes);

  assert.equal(getVerifiedAimDownload(inspected).fileName, 'instrument-verified.aim');
});
