import { basename, isAbsolute, relative, resolve, sep } from 'node:path';

export function resolveStoragePath(root: string, ...segments: string[]): string {
  if (segments.some((segment) => basename(segment) !== segment)) {
    throw new Error('Storage path escapes its root');
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...segments);
  const rel = relative(resolvedRoot, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Storage path escapes its root');
  }
  return target;
}
