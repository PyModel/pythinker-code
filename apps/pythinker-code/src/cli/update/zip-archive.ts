/**
 * Minimal reader for the release archives the native updater downloads:
 * a plain (non-ZIP64) zip holding one platform binary, produced by
 * `scripts/native/package.mjs` with yazl. Only the two compression methods
 * zip writers emit in practice are supported (stored, deflate); anything
 * else is rejected rather than guessed at. Nothing here is a general zip
 * library — the archive comes from our own release pipeline over HTTPS and
 * its sha256 was verified before this code ever runs.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { createInflateRaw } from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const LOCAL_FILE_HEADER_SIZE = 30;
const MAX_ZIP_COMMENT_SIZE = 0xffff;
const ZIP64_MARKER_16 = 0xffff;
const ZIP64_MARKER_32 = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export interface ExtractedZipEntry {
  /** sha256 (hex) of the extracted bytes. */
  readonly sha256: string;
  readonly size: number;
}

async function readRange(zipPath: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(zipPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(buffer, filled, length - filled, position + filled);
      if (bytesRead === 0) {
        throw new Error('zip archive is truncated');
      }
      filled += bytesRead;
    }
    return buffer;
  } finally {
    await handle.close();
  }
}

function findEndOfCentralDirectory(tail: Buffer): number {
  for (let offset = tail.length - END_OF_CENTRAL_DIRECTORY_SIZE; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  throw new Error('zip archive has no end-of-central-directory record');
}

/** List the entries recorded in the archive's central directory. */
export async function readZipEntries(zipPath: string): Promise<readonly ZipEntry[]> {
  const { size } = await stat(zipPath);
  if (size < END_OF_CENTRAL_DIRECTORY_SIZE) {
    throw new Error('zip archive is too small to be valid');
  }
  const tailLength = Math.min(size, END_OF_CENTRAL_DIRECTORY_SIZE + MAX_ZIP_COMMENT_SIZE);
  const tail = await readRange(zipPath, size - tailLength, tailLength);
  const eocd = findEndOfCentralDirectory(tail);
  const entryCount = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  if (entryCount === ZIP64_MARKER_16 || directoryOffset === ZIP64_MARKER_32) {
    throw new Error('ZIP64 archives are not supported');
  }
  if (directoryOffset + directorySize > size) {
    throw new Error('zip central directory lies outside the archive');
  }
  const directory = await readRange(zipPath, directoryOffset, directorySize);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + CENTRAL_DIRECTORY_HEADER_SIZE > directory.length ||
      directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE
    ) {
      throw new Error('zip central directory is malformed');
    }
    const method = directory.readUInt16LE(offset + 10);
    const compressedSize = directory.readUInt32LE(offset + 20);
    const uncompressedSize = directory.readUInt32LE(offset + 24);
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const localHeaderOffset = directory.readUInt32LE(offset + 42);
    const nameStart = offset + CENTRAL_DIRECTORY_HEADER_SIZE;
    if (nameStart + nameLength > directory.length) {
      throw new Error('zip central directory is malformed');
    }
    if (
      compressedSize === ZIP64_MARKER_32 ||
      uncompressedSize === ZIP64_MARKER_32 ||
      localHeaderOffset === ZIP64_MARKER_32
    ) {
      throw new Error('ZIP64 archives are not supported');
    }
    entries.push({
      name: directory.subarray(nameStart, nameStart + nameLength).toString('utf-8'),
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Write one entry's decompressed bytes to `destPath`, hashing them on the
 * way. Short writes are retried so the file on disk is exactly the bytes
 * that were hashed. **Throws** when the archive is malformed, uses an
 * unsupported compression method, or the extracted size disagrees with the
 * central directory.
 */
export async function extractZipEntry(
  zipPath: string,
  entry: ZipEntry,
  destPath: string,
): Promise<ExtractedZipEntry> {
  if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
    throw new Error(`unsupported zip compression method: ${String(entry.method)}`);
  }
  const localHeader = await readRange(zipPath, entry.localHeaderOffset, LOCAL_FILE_HEADER_SIZE);
  if (localHeader.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error('zip local file header is malformed');
  }
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + LOCAL_FILE_HEADER_SIZE + nameLength + extraLength;
  const { size: archiveSize } = await stat(zipPath);
  if (dataStart + entry.compressedSize > archiveSize) {
    throw new Error('zip entry data lies outside the archive');
  }

  const hash = createHash('sha256');
  let size = 0;
  const file = await open(destPath, 'w');
  try {
    if (entry.compressedSize > 0) {
      const source = createReadStream(zipPath, {
        start: dataStart,
        end: dataStart + entry.compressedSize - 1,
      });
      const decoded: AsyncIterable<Buffer> =
        entry.method === METHOD_DEFLATE ? source.pipe(createInflateRaw()) : source;
      for await (const chunk of decoded) {
        hash.update(chunk);
        size += chunk.length;
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await file.write(chunk, offset);
          if (bytesWritten === 0) {
            throw new Error('failed to write the extracted binary to disk (disk full?)');
          }
          offset += bytesWritten;
        }
      }
    }
  } finally {
    await file.close();
  }
  if (size !== entry.uncompressedSize) {
    throw new Error(
      `zip entry size mismatch: expected ${String(entry.uncompressedSize)} bytes, got ${String(size)}`,
    );
  }
  return { sha256: hash.digest('hex'), size };
}

/**
 * The release archive contract: exactly one file entry. Anything else means
 * the download is not a release artifact this updater knows how to install.
 */
export async function readSingleZipEntry(zipPath: string): Promise<ZipEntry> {
  const entries = await readZipEntries(zipPath);
  if (entries.length !== 1) {
    throw new Error(
      `expected a single-entry archive, found ${String(entries.length)} entries`,
    );
  }
  const [entry] = entries;
  if (entry === undefined || entry.name.endsWith('/')) {
    throw new Error('release archive does not contain a file entry');
  }
  return entry;
}
