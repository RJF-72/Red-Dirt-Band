import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverDrumFiles, discoverSampleFiles, instrumentFromSamplePath, normalizeInstrumentFolder } from './sample-folder';

function file(name: string, webkitRelativePath = '') {
  return Object.assign(new File(['sample'], name, { type: name.endsWith('.ogg') ? 'audio/ogg' : 'text/plain' }), { webkitRelativePath });
}

test('normalizes equivalent instrument folder labels', () => {
  assert.equal(normalizeInstrumentFolder('electric guitar'), 'electric-guitar');
  assert.equal(normalizeInstrumentFolder('electric-guitar'), 'electric-guitar');
  assert.equal(normalizeInstrumentFolder('electric_guitar'), 'electric-guitar');
  assert.equal(normalizeInstrumentFolder('Pedal Steel Guitar'), 'pedal-steel');
  assert.equal(normalizeInstrumentFolder('unknown'), null);
});

test('finds the deepest known instrument folder recursively', () => {
  assert.equal(instrumentFromSamplePath('AIM(Advannced Instrument Modeling)/guitars/electric_guitar/take-01.ogg'), 'electric-guitar');
  assert.equal(instrumentFromSamplePath('AIM(Advannced Instrument Modeling)/keyboard/lead/take.ogg'), 'keyboard');
});

test('groups recursive OGG files and reports unsupported or unrecognized files', () => {
  const result = discoverSampleFiles([
    file('amp.ogg', 'AIM(Advannced Instrument Modeling)/electric guitar/amp.ogg'),
    file('amp-2.ogg', 'AIM(Advannced Instrument Modeling)/electric_guitar/amp-2.ogg'),
    file('keys.ogg', 'AIM(Advannced Instrument Modeling)/keyboard/lead/keys.ogg'),
    file('notes.txt', 'AIM(Advannced Instrument Modeling)/electric guitar/notes.txt'),
    file('mystery.ogg', 'AIM(Advannced Instrument Modeling)/other/mystery.ogg'),
  ], 'acoustic-guitar');

  assert.equal(result.rootName, 'AIM(Advannced Instrument Modeling)');
  assert.equal(result.groups['electric-guitar'].length, 2);
  assert.equal(result.groups.keyboard.length, 1);
  assert.deepEqual(result.skipped.map((item) => item.reason), ['unsupported-file', 'unrecognized-instrument-folder']);
});

test('keeps the Drums folder in its dedicated country-kit scan lane', () => {
  const result = discoverDrumFiles([
    file('kick.ogg', 'Drums/kick/kick.ogg'),
    file('snare.ogg', 'Drums/snare/snare.ogg'),
    file('notes.txt', 'Drums/notes.txt'),
  ]);

  assert.equal(result.rootName, 'Drums');
  assert.deepEqual(result.files.map((item) => item.sourcePath), ['Drums/kick/kick.ogg', 'Drums/snare/snare.ogg']);
  assert.deepEqual(result.skipped.map((item) => item.reason), ['unsupported-file']);
});