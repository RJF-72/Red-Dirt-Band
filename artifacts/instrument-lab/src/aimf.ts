export type AimLayer = { name: string; bytes: number; type?: string; role?: string };

export type ParsedAim = {
  fileName: string;
  containerVersion: number;
  metadata: Record<string, any>;
  layers: AimLayer[];
  totalBytes: number;
  bytes: Uint8Array;
};

export function parseAimFile(fileName: string, bytes: Uint8Array): ParsedAim {
  const fail = (message: string): never => { throw new Error(message); };
  if (bytes.length < 12) fail('This file is too small to contain an AIMF header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (magic !== 'AIMF') fail('The file does not start with the AIMF signature. Choose an exported .aim package.');
  const containerVersion = view.getUint16(4, true);
  if (containerVersion !== 1) fail(`Container version ${containerVersion} is not supported. This workbench supports AIM version 0.1 (container 1).`);
  const metadataLength = view.getUint32(6, true);
  const layerCount = view.getUint16(10, true);
  const metadataStart = 12;
  const metadataEnd = metadataStart + metadataLength;
  if (metadataEnd > bytes.length) fail('The metadata section is truncated. Re-export the package and try again.');
  let metadata: Record<string, any> = {};
  try {
    metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(metadataStart, metadataEnd)));
  } catch {
    fail('The AIM metadata is not valid UTF-8 JSON. Re-export the package and try again.');
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('The AIM metadata must be a JSON object.');
  const layers: AimLayer[] = [];
  let offset = metadataEnd;
  for (let index = 0; index < layerCount; index += 1) {
    if (offset + 6 > bytes.length) fail(`Source layer ${index + 1} is missing its record header.`);
    const nameLength = view.getUint16(offset, true);
    const payloadLength = view.getUint32(offset + 2, true);
    offset += 6;
    if (offset + nameLength + payloadLength > bytes.length) fail(`Source layer ${index + 1} is truncated. Re-export the package and try again.`);
    let name = '';
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, offset + nameLength));
    } catch {
      fail(`Source layer ${index + 1} has an invalid filename.`);
    }
    if (!name || !name.toLowerCase().endsWith('.ogg')) fail(`Source layer ${index + 1} is not an OGG reference layer.`);
    layers.push({ name, bytes: payloadLength });
    offset += nameLength + payloadLength;
  }
  if (offset !== bytes.length) fail('The package contains trailing bytes outside its declared metadata and source layers.');
  const manifest = (metadata as { assets?: unknown }).assets;
  if (!Array.isArray(manifest) || manifest.length !== layerCount) fail('The source-layer manifest does not match the container layer count.');
  return { fileName, containerVersion, metadata, layers, totalBytes: bytes.length, bytes: bytes.slice() };
}

export function getVerifiedAimDownload(inspected: Pick<ParsedAim, 'fileName' | 'bytes'>) {
  const baseName = inspected.fileName.replace(/\.aim$/i, '') || 'instrument';
  return { bytes: inspected.bytes, fileName: `${baseName}-verified.aim` };
}