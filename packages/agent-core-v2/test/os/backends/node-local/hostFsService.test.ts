import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HostFileSystem } from '#/os/backends/node-local/hostFsService';

let dir: string;
let fs: HostFileSystem;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pythinker-hostfs-'));
  fs = new HostFileSystem();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HostFileSystem atomic writes', () => {
  it('replaces the symlink target in place and keeps the link', async () => {
    const target = join(dir, 'target.txt');
    await writeFile(target, 'old', 'utf-8');
    await chmod(target, 0o600);
    const link = join(dir, 'link.txt');
    await symlink(target, link);

    await fs.writeText(link, 'new');

    expect(await readFile(target, 'utf-8')).toBe('new');
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
    expect((await readdir(dir)).toSorted()).toEqual(['link.txt', 'target.txt']);
  });

  it('creates a missing file and leaves no staging files behind', async () => {
    const path = join(dir, 'fresh.txt');
    await fs.writeBytes(path, new Uint8Array([104, 105]));
    expect(await readFile(path, 'utf-8')).toBe('hi');
    expect(await readdir(dir)).toEqual(['fresh.txt']);
  });

  it('keeps the previous content when the replacement cannot be staged', async () => {
    const path = join(dir, 'keep.txt');
    await writeFile(path, 'intact', 'utf-8');
    await chmod(dir, 0o500);
    try {
      await expect(fs.writeText(path, 'partial')).rejects.toThrow();
    } finally {
      await chmod(dir, 0o700);
    }
    expect(await readFile(path, 'utf-8')).toBe('intact');
  });
});

describe('HostFileSystem readLines budget', () => {
  it('bounds a newline-free line to maxLineBytes', async () => {
    const path = join(dir, 'long.txt');
    await writeFile(path, `${'x'.repeat(300_000)}\nshort\n`, 'utf-8');

    const lines: string[] = [];
    for await (const line of fs.readLines(path, { maxLineBytes: 1024 })) lines.push(line);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${'x'.repeat(1024)}\n`);
    expect(lines[1]).toBe('short\n');
  });

  it('bounds a trailing line without a terminator', async () => {
    const path = join(dir, 'tail.txt');
    await writeFile(path, `a\n${'y'.repeat(5000)}`, 'utf-8');

    const lines: string[] = [];
    for await (const line of fs.readLines(path, { maxLineBytes: 16 })) lines.push(line);

    expect(lines).toEqual(['a\n', 'y'.repeat(16)]);
  });

  it('reads every byte when no budget is given', async () => {
    const path = join(dir, 'full.txt');
    const long = 'z'.repeat(200_000);
    await writeFile(path, `${long}\n`, 'utf-8');

    const lines: string[] = [];
    for await (const line of fs.readLines(path)) lines.push(line);

    expect(lines).toEqual([`${long}\n`]);
  });
});

describe('HostFileSystem stat / lstat', () => {
  it('stat follows a symlink to a regular file while lstat stats the link', async () => {
    const target = join(dir, 'target.txt');
    await writeFile(target, 'hello', 'utf-8');
    const link = join(dir, 'link.txt');
    await symlink(target, link);

    const st = await fs.stat(link);
    expect(st.isFile).toBe(true);
    expect(st.isSymbolicLink).not.toBe(true);

    const lst = await fs.lstat(link);
    expect(lst.isSymbolicLink).toBe(true);
    expect(lst.isFile).toBe(false);
  });

  it('stat follows a symlink to a directory', async () => {
    const target = join(dir, 'subdir');
    await mkdir(target);
    const link = join(dir, 'dirlink');
    await symlink(target, link);

    expect((await fs.stat(link)).isDirectory).toBe(true);
    expect((await fs.lstat(link)).isDirectory).toBe(false);
  });

  it('stat rejects a dangling symlink while lstat still stats the link', async () => {
    const link = join(dir, 'dangling');
    await symlink(join(dir, 'missing'), link);

    await expect(fs.stat(link)).rejects.toThrow();
    expect((await fs.lstat(link)).isSymbolicLink).toBe(true);
  });
});
