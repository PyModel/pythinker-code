import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import { type Entry, fromBuffer as yauzlFromBuffer } from 'yauzl';

export async function downloadZip(url: string, signal?: AbortSignal): Promise<Buffer> {
  const resp = await fetch(url, { signal: signal ?? AbortSignal.timeout(5 * 60 * 1000) });
  if (!resp.ok) {
    throw new Error(`Failed to download zip: HTTP ${resp.status} ${resp.statusText}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export interface ExtractZipOptions {
  readonly repositorySubdirectory?: string;
  readonly allowManifestless?: boolean;
}

export async function extractZip(
  buffer: Buffer,
  destDir: string,
  options: ExtractZipOptions = {},
): Promise<string> {
  await mkdir(destDir, { recursive: true });
  const destDirResolved = path.resolve(destDir);
  const destDirReal = await realpath(destDir);
  let settled = false;

  await new Promise<void>((resolve, reject) => {
    yauzlFromBuffer(buffer, { lazyEntries: true }, (openErr, zipfile) => {
      if (openErr !== null || zipfile === undefined) {
        reject(new Error(`Failed to open zip: ${openErr?.message ?? 'unknown error'}`));
        return;
      }

      const onEntry = (entry: Entry): void => {
        const fileName = entry.fileName;
        const destPath = path.resolve(destDir, fileName);

        if (!isWithin(destPath, destDirResolved)) {
          if (!settled) {
            settled = true;
            reject(new Error(`Path traversal detected in zip entry: ${fileName}`));
          }
          zipfile.close();
          return;
        }

        if (fileName.endsWith('/')) {
          prepareArchiveDirectory(destPath, destDirReal, fileName)
            .then(() => {
              zipfile.readEntry();
            })
            .catch((error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
              zipfile.close();
            });
          return;
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr !== null || stream === undefined) {
            if (!settled) {
              settled = true;
              reject(
                new Error(
                  `Failed to read ${fileName} from archive: ${streamErr?.message ?? 'unknown error'}`,
                ),
              );
            }
            zipfile.close();
            return;
          }

          prepareArchiveFile(destPath, destDirReal, fileName)
            .then(() => pipeline(stream, createWriteStream(destPath)))
            .then(() => restoreFilePermissions(destPath, entry))
            .then(() => {
              zipfile.readEntry();
            })
            .catch((error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
              zipfile.close();
            });
        });
      };

      zipfile.on('entry', onEntry);
      zipfile.on('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zipfile.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      zipfile.readEntry();
    });
  });

  const wrapperRoot = await detectArchiveWrapperRoot(destDir);
  if (options.repositorySubdirectory !== undefined) {
    return resolveRepositorySubdirectory(wrapperRoot, options.repositorySubdirectory);
  }
  return wrapperRoot !== destDir &&
    ((await hasManifest(wrapperRoot)) || options.allowManifestless === true)
    ? wrapperRoot
    : destDir;
}

async function prepareArchiveFile(
  destPath: string,
  destDirReal: string,
  fileName: string,
): Promise<void> {
  await prepareArchiveDirectory(path.dirname(destPath), destDirReal, fileName);
  const existingReal = await realpath(destPath).catch(() => undefined);
  if (existingReal !== undefined && !isWithin(existingReal, destDirReal)) {
    throw new Error(`Zip entry resolves outside extraction directory: ${fileName}`);
  }
}

async function prepareArchiveDirectory(
  directory: string,
  destDirReal: string,
  fileName: string,
): Promise<void> {
  const ancestorReal = await nearestExistingRealpath(directory);
  if (!isWithin(ancestorReal, destDirReal)) {
    throw new Error(`Zip entry resolves outside extraction directory: ${fileName}`);
  }
  await mkdir(directory, { recursive: true });
  const directoryReal = await realpath(directory);
  if (!isWithin(directoryReal, destDirReal)) {
    throw new Error(`Zip entry resolves outside extraction directory: ${fileName}`);
  }
}

async function nearestExistingRealpath(value: string): Promise<string> {
  let current = value;
  while (true) {
    try {
      return await realpath(current);
    } catch (error) {
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function restoreFilePermissions(destPath: string, entry: Entry): Promise<void> {
  const mode = entry.externalFileAttributes >>> 16;
  if (mode === 0) return;
  const permissions = mode & 0o777;
  if (permissions === 0) return;
  await chmod(destPath, permissions);
}

async function detectArchiveWrapperRoot(dir: string): Promise<string> {
  if (await hasManifest(dir)) return dir;

  const entries = await readdir(dir, { withFileTypes: true });
  const onlyEntry = entries.length === 1 ? entries[0] : undefined;
  if (onlyEntry?.isDirectory() !== true) return dir;

  const child = path.join(dir, onlyEntry.name);
  const childReal = await realpath(child);
  const rootReal = await realpath(dir);
  return isWithin(childReal, rootReal) ? child : dir;
}

async function resolveRepositorySubdirectory(
  wrapperRoot: string,
  repositorySubdirectory: string,
): Promise<string> {
  const requested = repositorySubdirectory.trim();
  if (requested.length === 0) {
    throw new Error('Plugin repository subdirectory cannot be empty');
  }
  if (path.posix.isAbsolute(requested) || path.win32.isAbsolute(requested)) {
    throw new Error(
      `Plugin repository subdirectory must be relative (got "${repositorySubdirectory}")`,
    );
  }

  const segments = requested.replaceAll('\\', '/').split('/');
  if (segments.includes('..')) {
    throw new Error(
      `Plugin repository subdirectory cannot contain traversal (got "${repositorySubdirectory}")`,
    );
  }

  const root = path.resolve(wrapperRoot);
  const rootReal = await realpath(wrapperRoot);
  const candidate = path.resolve(root, ...segments);
  if (!isWithin(candidate, root)) {
    throw new Error(
      `Plugin repository subdirectory resolves outside the archive (${repositorySubdirectory})`,
    );
  }

  let selectedReal: string;
  try {
    selectedReal = await realpath(candidate);
  } catch (error) {
    throw new Error(`Plugin repository subdirectory does not exist: ${repositorySubdirectory}`, {
      cause: error,
    });
  }
  if (!isWithin(selectedReal, rootReal)) {
    throw new Error(
      `Plugin repository subdirectory resolves outside the archive (${repositorySubdirectory})`,
    );
  }
  if (!(await stat(selectedReal)).isDirectory()) {
    throw new Error(`Plugin repository subdirectory is not a directory: ${repositorySubdirectory}`);
  }
  return candidate;
}

async function hasManifest(dir: string): Promise<boolean> {
  const rootManifest = path.join(dir, 'pythinker.plugin.json');
  const dirManifest = path.join(dir, '.pythinker-plugin', 'plugin.json');
  const claudeManifest = path.join(dir, '.claude-plugin', 'plugin.json');
  return (
    (await isFile(rootManifest)) || (await isFile(dirManifest)) || (await isFile(claudeManifest))
  );
}

function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}
