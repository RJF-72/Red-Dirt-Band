export type SampleInstrumentId =
  | 'acoustic-guitar'
  | 'bass-guitar'
  | 'electric-guitar'
  | 'pedal-steel'
  | 'fiddle'
  | 'keyboard';

export const sampleInstrumentOrder: SampleInstrumentId[] = [
  'acoustic-guitar',
  'bass-guitar',
  'electric-guitar',
  'pedal-steel',
  'fiddle',
  'keyboard',
];

export type SampleFileGroup = {
  file: File;
  sourcePath: string;
  instrument: SampleInstrumentId;
};

export type SkippedSampleFile = {
  sourcePath: string;
  reason: 'unsupported-file' | 'unrecognized-instrument-folder';
};

export type DiscoveredSampleFiles = {
  rootName: string | null;
  groups: Record<SampleInstrumentId, SampleFileGroup[]>;
  skipped: SkippedSampleFile[];
};

export type DiscoveredDrumFiles = {
  rootName: string | null;
  files: Array<{ file: File; sourcePath: string }>;
  skipped: SkippedSampleFile[];
};

const aliases: Record<string, SampleInstrumentId> = {
  acoustic: 'acoustic-guitar',
  acousticguitar: 'acoustic-guitar',
  bass: 'bass-guitar',
  bassguitar: 'bass-guitar',
  electric: 'electric-guitar',
  electricguitar: 'electric-guitar',
  fiddle: 'fiddle',
  keyboard: 'keyboard',
  keys: 'keyboard',
  pedalsteel: 'pedal-steel',
  pedalsteelguitar: 'pedal-steel',
  piano: 'keyboard',
  violin: 'fiddle',
};

function compactFolderName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeInstrumentFolder(value: string): SampleInstrumentId | null {
  return aliases[compactFolderName(value)] ?? null;
}

export function instrumentFromSamplePath(sourcePath: string): SampleInstrumentId | null {
  const parts = sourcePath.split(/[\\/]/).filter(Boolean);
  for (const part of parts.slice(0, -1).reverse()) {
    const instrument = normalizeInstrumentFolder(part);
    if (instrument) return instrument;
  }
  return null;
}

export function createSampleGroups(): Record<SampleInstrumentId, SampleFileGroup[]> {
  return sampleInstrumentOrder.reduce((groups, instrument) => {
    groups[instrument] = [];
    return groups;
  }, {} as Record<SampleInstrumentId, SampleFileGroup[]>);
}

export function discoverSampleFiles(files: File[], fallbackInstrument: SampleInstrumentId): DiscoveredSampleFiles {
  const groups = createSampleGroups();
  const skipped: SkippedSampleFile[] = [];
  const rootNames = new Set<string>();

  files.forEach((file) => {
    const sourcePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const pathParts = sourcePath.split(/[\\/]/).filter(Boolean);
    if (pathParts.length > 1) rootNames.add(pathParts[0]);

    if (!file.name.toLocaleLowerCase().endsWith('.ogg')) {
      skipped.push({ sourcePath, reason: 'unsupported-file' });
      return;
    }

    // A loose file upload, or files directly inside the selected root folder,
    // belongs to the currently selected instrument. Nested unknown folders are
    // skipped rather than silently assigned to the wrong instrument.
    const instrument = instrumentFromSamplePath(sourcePath)
      ?? (pathParts.length <= 1 || pathParts.length === 2 ? fallbackInstrument : null);
    if (!instrument) {
      skipped.push({ sourcePath, reason: 'unrecognized-instrument-folder' });
      return;
    }
    groups[instrument].push({ file, sourcePath, instrument });
  });

  return { rootName: rootNames.size === 1 ? [...rootNames][0] : rootNames.size ? 'multiple folders' : null, groups, skipped };
}

export function discoverDrumFiles(files: File[]): DiscoveredDrumFiles {
  const discovered: DiscoveredDrumFiles['files'] = [];
  const skipped: SkippedSampleFile[] = [];
  const rootNames = new Set<string>();

  files.forEach((file) => {
    const sourcePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const pathParts = sourcePath.split(/[\\/]/).filter(Boolean);
    if (pathParts.length > 1) rootNames.add(pathParts[0]);
    const isDrumPath = pathParts.slice(0, -1).some((part) => compactFolderName(part) === 'drums')
      || (pathParts.length <= 1 && compactFolderName(file.name.replace(/\.ogg$/i, '')) === 'drums');
    if (!isDrumPath) return;
    if (!file.name.toLocaleLowerCase().endsWith('.ogg')) {
      skipped.push({ sourcePath, reason: 'unsupported-file' });
      return;
    }
    discovered.push({ file, sourcePath });
  });

  return {
    rootName: rootNames.size === 1 ? [...rootNames][0] : rootNames.size ? 'multiple folders' : null,
    files: discovered,
    skipped,
  };
}