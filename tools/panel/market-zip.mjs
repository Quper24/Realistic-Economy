import { inflateRawSync } from 'node:zlib';

export function zipEntries(bytes, names, limit) {
  // Look for the end record after the central directory, before an optional ZIP comment.
  let end = bytes.length - 22;
  const earliest = Math.max(0, end - 65_535);
  for (; end >= earliest; end--) {
    if (bytes.readUInt32LE(end) === 0x06054b50 && end + 22 + bytes.readUInt16LE(end + 20) === bytes.length) break;
  }
  if (end < earliest || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) {
    throw new Error('источник вернул ответ без поддерживаемого ZIP-архива');
  }
  const count = bytes.readUInt16LE(end + 10);
  const directory = bytes.readUInt32LE(end + 16);
  const directoryEnd = directory + bytes.readUInt32LE(end + 12);
  if (directoryEnd > end || count === 0xffff) throw new Error('повреждён каталог ZIP-архива');

  const found = new Map();
  for (let index = 0, offset = directory; index < count; index++) {
    if (offset + 46 > directoryEnd || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('повреждён каталог ZIP-архива');
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next = offset + 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
    if (next > directoryEnd) throw new Error('повреждён каталог ZIP-архива');
    const name = bytes.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (names.includes(name)) {
      const flags = bytes.readUInt16LE(offset + 8);
      const method = bytes.readUInt16LE(offset + 10);
      const compressed = bytes.readUInt32LE(offset + 20);
      const size = bytes.readUInt32LE(offset + 24);
      const local = bytes.readUInt32LE(offset + 42);
      if (found.has(name) || flags & 1 || ![0, 8].includes(method) || size > limit || local + 30 > directory ||
          bytes.readUInt32LE(local) !== 0x04034b50) throw new Error(`не удалось прочитать ${name} в ZIP-архиве`);
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > directory) throw new Error(`повреждён файл ${name} в ZIP-архиве`);
      const data = bytes.subarray(start, start + compressed);
      const contents = method === 0 ? data : inflateRawSync(data, { maxOutputLength: limit });
      if (contents.length !== size) throw new Error(`повреждён файл ${name} в ZIP-архиве`);
      found.set(name, contents.toString('utf8'));
    }
    offset = next;
  }
  return names.map(name => {
    if (!found.has(name)) throw new Error(`в ZIP-архиве нет таблицы ${name}`);
    return found.get(name);
  });
}
