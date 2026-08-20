import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';

import { join } from 'pathe';

import { abortable } from '../../utils/abort';

export type RgResolutionSource = 'system-path' | 'vendor' | 'share-bin-cached';

export interface RgResolution {
  readonly path: string;
  readonly source: RgResolutionSource;
}

export interface EnsureRgPathOptions {
  readonly shareDir?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export async function ensureRgPath(options: EnsureRgPathOptions = {}): Promise<RgResolution> {
  options.signal?.throwIfAborted();
  const resolution = resolveRgPath(options.shareDir ?? getShareDir(), options.signal);
  return options.signal === undefined ? resolution : abortable(resolution, options.signal);
}

async function resolveRgPath(
  shareDir: string,
  signal?: AbortSignal | undefined,
): Promise<RgResolution> {
  const existing = await findExistingRg(shareDir);
  if (existing !== undefined) return existing;
  signal?.throwIfAborted();
  throw new Error('ripgrep (rg) is not available on PATH');
}

export async function findExistingRg(shareDir: string): Promise<RgResolution | undefined> {
  const binName = rgBinaryName();
  const systemRg = await whichRg();
  if (systemRg !== undefined) return { path: systemRg, source: 'system-path' };
  const vendorPath = getVendorRgPath(binName);
  if (vendorPath !== undefined && (await isExecutableFile(vendorPath))) {
    return { path: vendorPath, source: 'vendor' };
  }
  const cachePath = join(shareDir, 'bin', binName);
  if (await isExecutableFile(cachePath)) {
    return { path: cachePath, source: 'share-bin-cached' };
  }
  return undefined;
}

function rgBinaryName(): string {
  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

function getShareDir(): string {
  const override = process.env['PYTHINKER_CODE_HOME'];
  if (override !== undefined && override !== '') return override;
  return join(homedir(), '.pythinker-code');
}

function getVendorRgPath(_binName: string): string | undefined {
  return undefined;
}

async function whichRg(): Promise<string | undefined> {
  const pathEnv = process.env['PATH'] ?? '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const binName = rgBinaryName();
  for (const dir of pathEnv.split(sep)) {
    if (dir === '') continue;
    const candidate = join(dir, binName);
    if (await isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export function rgUnavailableMessage(cause: unknown): string {
  const detail =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown error';
  const shareBin = join(getShareDir(), 'bin', rgBinaryName());
  return (
    `ripgrep (rg) is not available.\n` +
    `\n` +
    `Error: ${detail}\n` +
    `\n` +
    `Fix options:\n` +
    `  macOS:   brew install ripgrep\n` +
    `  Ubuntu:  sudo apt-get install ripgrep\n` +
    `  Other:   https://github.com/BurntSushi/ripgrep#installation\n` +
    `\n` +
    `Alternatively, drop a static rg binary at ${shareBin}`
  );
}
