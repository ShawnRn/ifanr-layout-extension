(function attachIfanrZipReader(global) {
  const EOCD = 0x06054b50;
  const CENTRAL_FILE = 0x02014b50;
  const LOCAL_FILE = 0x04034b50;

  function findEndOfCentralDirectory(view) {
    const minimum = Math.max(0, view.byteLength - 0xffff - 22);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === EOCD) return offset;
    }
    throw new Error('ZIP_END_NOT_FOUND');
  }

  function decodeName(bytes) {
    return new TextDecoder('utf-8').decode(bytes).replace(/\\/g, '/');
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('ZIP_DEFLATE_UNAVAILABLE');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readEntries(buffer) {
    const source = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
    const eocd = findEndOfCentralDirectory(view);
    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = [];

    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== CENTRAL_FILE) throw new Error('ZIP_CENTRAL_DIRECTORY_INVALID');
      const compression = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decodeName(source.subarray(offset + 46, offset + 46 + nameLength));
      if (view.getUint32(localOffset, true) !== LOCAL_FILE) throw new Error('ZIP_LOCAL_HEADER_INVALID');
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = source.slice(dataOffset, dataOffset + compressedSize);
      let bytes;
      if (compression === 0) bytes = compressed;
      else if (compression === 8) bytes = await inflate(compressed);
      else throw new Error(`ZIP_COMPRESSION_UNSUPPORTED_${compression}`);
      if (uncompressedSize && bytes.byteLength !== uncompressedSize) throw new Error('ZIP_ENTRY_SIZE_MISMATCH');
      entries.push({ name, bytes, directory: name.endsWith('/') });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }

  global.IFANR_ZIP_READER = Object.freeze({ readEntries });
})(globalThis);
