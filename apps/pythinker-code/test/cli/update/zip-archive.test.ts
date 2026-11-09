import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import { extractZipEntry, readSingleZipEntry, readZipEntries } from '#/cli/update/zip-archive';

interface ZipInput {
  readonly name: string;
  readonly bytes: Buffer;
  readonly compress?: boolean;
}

async function buildZip(inputs: readonly ZipInput[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const input of inputs) {
    zip.addBuffer(input.bytes, input.name, { compress: input.compress ?? true });
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('zip-archive', () => {
  let workDir: string;
  let zipPath: string;
  let outPath: string;
  const payload = Buffer.from('fake-sea-binary-payload '.repeat(2000));

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'pythinker-zip-test-'));
    zipPath = join(workDir, 'artifact.zip');
    outPath = join(workDir, 'out.bin');
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('lists the entries recorded in the central directory', async () => {
    await writeFile(
      zipPath,
      await buildZip([
        { name: 'pythinker', bytes: payload },
        { name: 'README', bytes: Buffer.from('hi'), compress: false },
      ]),
    );
    const entries = await readZipEntries(zipPath);
    expect(entries.map((entry) => entry.name)).toEqual(['pythinker', 'README']);
    expect(entries[0]?.method).toBe(8);
    expect(entries[0]?.uncompressedSize).toBe(payload.length);
    expect(entries[1]?.method).toBe(0);
  });

  it('extracts a deflated entry and reports its sha256 and size', async () => {
    await writeFile(zipPath, await buildZip([{ name: 'pythinker', bytes: payload }]));
    const entry = await readSingleZipEntry(zipPath);
    const result = await extractZipEntry(zipPath, entry, outPath);
    expect(result).toEqual({ sha256: sha256Hex(payload), size: payload.length });
    expect((await readFile(outPath)).equals(payload)).toBe(true);
  });

  it('extracts a stored entry', async () => {
    await writeFile(
      zipPath,
      await buildZip([{ name: 'pythinker.exe', bytes: payload, compress: false }]),
    );
    const entry = await readSingleZipEntry(zipPath);
    const result = await extractZipEntry(zipPath, entry, outPath);
    expect(result.sha256).toBe(sha256Hex(payload));
    expect((await readFile(outPath)).equals(payload)).toBe(true);
  });

  it('rejects an archive with more than one entry', async () => {
    await writeFile(
      zipPath,
      await buildZip([
        { name: 'pythinker', bytes: payload },
        { name: 'README', bytes: Buffer.from('hi') },
      ]),
    );
    await expect(readSingleZipEntry(zipPath)).rejects.toThrow(/single-entry archive, found 2/);
  });

  it('rejects bytes that are not a zip archive', async () => {
    await writeFile(zipPath, payload);
    await expect(readZipEntries(zipPath)).rejects.toThrow(/end-of-central-directory/);
  });

  it('rejects a truncated archive', async () => {
    const archive = await buildZip([{ name: 'pythinker', bytes: payload }]);
    await writeFile(zipPath, archive.subarray(0, 10));
    await expect(readZipEntries(zipPath)).rejects.toThrow(/too small/);
  });

  it('rejects an unsupported compression method', async () => {
    await writeFile(zipPath, await buildZip([{ name: 'pythinker', bytes: payload }]));
    const entry = await readSingleZipEntry(zipPath);
    await expect(extractZipEntry(zipPath, { ...entry, method: 12 }, outPath)).rejects.toThrow(
      /unsupported zip compression method: 12/,
    );
  });

  it('rejects an entry whose extracted size disagrees with the directory', async () => {
    await writeFile(zipPath, await buildZip([{ name: 'pythinker', bytes: payload }]));
    const entry = await readSingleZipEntry(zipPath);
    await expect(
      extractZipEntry(zipPath, { ...entry, uncompressedSize: entry.uncompressedSize + 1 }, outPath),
    ).rejects.toThrow(/size mismatch/);
  });
});
