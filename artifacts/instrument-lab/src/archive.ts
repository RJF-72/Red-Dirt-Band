export type ArchiveEntry = { name: string; bytes: Uint8Array };

const text = new TextEncoder();

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint16(offset, value, true);
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(offset, value >>> 0, true);
}

/** Creates a standards-compliant ZIP archive using store mode, keeping browser exports dependency-free. */
export function createZip(entries: ArchiveEntry[]) {
  const prepared = entries.map((entry) => ({ ...entry, nameBytes: text.encode(entry.name), crc: crc32(entry.bytes) }));
  const localSize = prepared.reduce((total, entry) => total + 30 + entry.nameBytes.length + entry.bytes.length, 0);
  const centralSize = prepared.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);
  const output = new Uint8Array(localSize + centralSize + 22);
  let cursor = 0;
  const offsets: number[] = [];

  prepared.forEach((entry) => {
    offsets.push(cursor);
    writeUint32(output, cursor, 0x04034b50);
    writeUint16(output, cursor + 4, 20);
    writeUint16(output, cursor + 6, 0);
    writeUint16(output, cursor + 8, 0);
    writeUint16(output, cursor + 10, 0);
    writeUint16(output, cursor + 12, 0);
    writeUint32(output, cursor + 14, entry.crc);
    writeUint32(output, cursor + 18, entry.bytes.length);
    writeUint32(output, cursor + 22, entry.bytes.length);
    writeUint16(output, cursor + 26, entry.nameBytes.length);
    writeUint16(output, cursor + 28, 0);
    output.set(entry.nameBytes, cursor + 30);
    output.set(entry.bytes, cursor + 30 + entry.nameBytes.length);
    cursor += 30 + entry.nameBytes.length + entry.bytes.length;
  });

  const centralOffset = cursor;
  prepared.forEach((entry, index) => {
    writeUint32(output, cursor, 0x02014b50);
    writeUint16(output, cursor + 4, 20);
    writeUint16(output, cursor + 6, 20);
    writeUint16(output, cursor + 8, 0);
    writeUint16(output, cursor + 10, 0);
    writeUint16(output, cursor + 12, 0);
    writeUint16(output, cursor + 14, 0);
    writeUint32(output, cursor + 16, entry.crc);
    writeUint32(output, cursor + 20, entry.bytes.length);
    writeUint32(output, cursor + 24, entry.bytes.length);
    writeUint16(output, cursor + 28, entry.nameBytes.length);
    writeUint16(output, cursor + 30, 0);
    writeUint16(output, cursor + 32, 0);
    writeUint16(output, cursor + 34, 0);
    writeUint16(output, cursor + 36, 0);
    writeUint32(output, cursor + 38, 0);
    writeUint32(output, cursor + 42, offsets[index]);
    output.set(entry.nameBytes, cursor + 46);
    cursor += 46 + entry.nameBytes.length;
  });

  writeUint32(output, cursor, 0x06054b50);
  writeUint16(output, cursor + 4, 0);
  writeUint16(output, cursor + 6, 0);
  writeUint16(output, cursor + 8, prepared.length);
  writeUint16(output, cursor + 10, prepared.length);
  writeUint32(output, cursor + 12, centralSize);
  writeUint32(output, cursor + 16, centralOffset);
  writeUint16(output, cursor + 20, 0);
  return output;
}