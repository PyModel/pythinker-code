import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SECRET_FILE = 'remote-control-secret';
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function remoteControlSecretPath(homeDir: string): string {
  return join(homeDir, SECRET_FILE);
}

// The relay admits a machine only for the device id its secret hashes to, so
// this file is what separates this machine from every other one on the relay.
// Deleting it gives the machine a new id and makes its old links dead.
export async function loadRemoteControlSecret(homeDir: string): Promise<string> {
  const path = remoteControlSecretPath(homeDir);
  const existing = await readSecret(path);
  if (existing !== undefined) return existing;
  await mkdir(homeDir, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, randomBytes(32).toString('base64url'), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (!isErrno(error, 'EEXIST')) throw error;
  }
  const created = await readSecret(path);
  if (created === undefined) {
    throw new Error(`Remote Control secret at ${path} is invalid. Delete the file to create a new one.`);
  }
  return created;
}

export function remoteControlDeviceId(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('base64url');
}

async function readSecret(path: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
  const secret = text.trim();
  if (!SECRET_PATTERN.test(secret)) {
    throw new Error(`Remote Control secret at ${path} is invalid. Delete the file to create a new one.`);
  }
  return secret;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
