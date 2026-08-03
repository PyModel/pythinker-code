

import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FsPathEscapesError,
  resolveSafePath,
} from '@pythoughts/agent-core';

let tmpDir: string;
let cwd: string;

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'pythinker-path-safety-'));
  cwd = join(tmpDir, 'workspace');
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'hello.txt'), 'hi');
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'index.ts'), 'export {}');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveSafePath', () => {
  it('resolves "." to the cwd root', async () => {
    const r = await resolveSafePath(cwd, '.');
    expect(r.relative).toBe('.');
  });

  it('resolves a one-level child', async () => {
    const r = await resolveSafePath(cwd, 'hello.txt');
    expect(r.relative).toBe('hello.txt');
    expect(r.absolute.endsWith('/hello.txt')).toBe(true);
  });

  it('resolves a nested path', async () => {
    const r = await resolveSafePath(cwd, 'src/index.ts');
    expect(r.relative).toBe('src/index.ts');
  });

  it('rejects the empty string', async () => {
    await expect(resolveSafePath(cwd, '')).rejects.toThrowError(FsPathEscapesError);
    const error = await captureRejection(resolveSafePath(cwd, ''));
    expect((error as FsPathEscapesError).reason).toBe('empty');
  });

  it('rejects the literal "/"', async () => {
    const error = await captureRejection(resolveSafePath(cwd, '/'));
    expect((error as FsPathEscapesError).reason).toBe('empty');
  });

  it('rejects an absolute POSIX path', async () => {
    const error = await captureRejection(resolveSafePath(cwd, '/etc/passwd'));
    expect((error as FsPathEscapesError).reason).toBe('absolute');
  });

  it('rejects any input containing a ".." segment (even when lexically inside cwd)', async () => {
    const error = await captureRejection(resolveSafePath(cwd, 'a/../hello.txt'));
    expect((error as FsPathEscapesError).reason).toBe('dotdot_segment');
  });

  it('rejects a "../../../etc/passwd"-style escape', async () => {
    const error = await captureRejection(resolveSafePath(cwd, '../../etc/passwd'));
    expect((error as FsPathEscapesError).reason).toBe('dotdot_segment');
  });

  it('rejects a symlink that targets a path OUTSIDE cwd', async () => {
    const outside = join(tmpDir, 'outside.txt');
    writeFileSync(outside, 'sneaky');
    symlinkSync(outside, join(cwd, 'escape'));
    const error = await captureRejection(resolveSafePath(cwd, 'escape'));
    expect(error).toBeInstanceOf(FsPathEscapesError);
    expect((error as FsPathEscapesError).reason).toBe('symlink_outside_cwd');
  });

  it('accepts a symlink that targets a path INSIDE cwd', async () => {
    symlinkSync(join(cwd, 'hello.txt'), join(cwd, 'alias'));
    const r = await resolveSafePath(cwd, 'alias');

    expect(r.relative).toBe('hello.txt');
  });

  it('accepts a missing-tail path (e.g. for future write or 40409 surface)', async () => {
    const r = await resolveSafePath(cwd, 'does-not-exist.txt');
    expect(r.relative).toBe('does-not-exist.txt');
  });
});
