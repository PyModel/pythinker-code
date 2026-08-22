// apps/pythinker-web/src/lib/fileIcons.ts
//
// Material Icon Theme file/folder icon resolver. Maps a path to the same icon
// VS Code shows with the Material Icon Theme extension: exact file name first,
// then the longest dotted extension suffix (`ts.map` beats `map`), then the
// default file icon; directories resolve through the folder-name theme.
// Light-scheme variants (`_light` icons) are selected when the UI runs light.
//
// Data comes from the generated src/lib/fileIconsData.ts (material-icon-theme).

import { useIsDark } from '../composables/useIsDark';
import {
  DEFAULT_FILE_ICON,
  DEFAULT_FOLDER_ICON,
  FILE_EXTENSIONS,
  FILE_NAMES,
  FOLDER_NAMES,
  LIGHT_FILE_EXTENSIONS,
  LIGHT_FILE_NAMES,
  LIGHT_FOLDER_NAMES,
  SVGS,
} from './fileIconsData';

function hasKey(map: Record<string, string>, key: string): boolean {
  return Object.hasOwn(map, key);
}

function pick(
  map: Record<string, string>,
  lightMap: Record<string, string>,
  key: string,
  light: boolean,
): string | undefined {
  const value = map[key];
  if (!light || !hasKey(lightMap, key)) return value;
  return lightMap[key];
}

/** True when the effective color scheme resolves to light (mirrors useIsDark). */
function isLightScheme(): boolean {
  // Non-browser / test environments without matchMedia resolve as dark.
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') return false;
  return !useIsDark().value;
}

function resolveFileName(base: string, light: boolean): string | undefined {
  const lower = base.toLowerCase();
  if (hasKey(FILE_NAMES, base)) return pick(FILE_NAMES, LIGHT_FILE_NAMES, base, light);
  if (hasKey(FILE_NAMES, lower)) return pick(FILE_NAMES, LIGHT_FILE_NAMES, lower, light);
  return undefined;
}

function resolveExtension(base: string, light: boolean): string | undefined {
  const lower = base.toLowerCase();
  const parts = lower.split('.');
  // Longest suffix first so `ts.map` wins over `map` and `d.ts` over `ts`.
  for (let index = 1; index < parts.length; index += 1) {
    const suffix = parts.slice(index).join('.');
    if (hasKey(FILE_EXTENSIONS, suffix)) {
      return pick(FILE_EXTENSIONS, LIGHT_FILE_EXTENSIONS, suffix, light);
    }
  }
  return undefined;
}

function resolveFolderName(segment: string, light: boolean): string | undefined {
  const lower = segment.toLowerCase();
  if (hasKey(FOLDER_NAMES, segment)) return pick(FOLDER_NAMES, LIGHT_FOLDER_NAMES, segment, light);
  if (hasKey(FOLDER_NAMES, lower)) return pick(FOLDER_NAMES, LIGHT_FOLDER_NAMES, lower, light);
  return undefined;
}

function lastSegment(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments.at(-1) ?? path;
}

function sized(svg: string): string {
  return svg
    .replaceAll(/\s(?:width|height)="[^"]*"/g, '')
    .replace(/^<svg\b/, '<svg class="ui-icon" width="14" height="14" aria-hidden="true"');
}

/**
 * Resolve a path (or display name) to its Material Icon Theme icon name.
 * Directories end with `/`. Unknown types yield the theme default file icon.
 */
export function fileIconName(path: string, displayName?: string): string {
  const light = isLightScheme();
  if (path.endsWith('/') || path.endsWith('\\')) {
    return resolveFolderName(lastSegment(path.slice(0, -1)), light) ?? DEFAULT_FOLDER_ICON;
  }
  const base = displayName ?? lastSegment(path);
  return resolveFileName(base, light) ?? resolveExtension(base, light) ?? DEFAULT_FILE_ICON;
}

/**
 * Raw inline `<svg>` for a file or directory path, styled like the shared sm
 * (14px) registry icons. See {@link fileIconName} for the resolution order.
 */
export function fileIconSvg(path: string, displayName?: string): string {
  const svg = SVGS[fileIconName(path, displayName)] ?? SVGS[DEFAULT_FILE_ICON];
  return svg === undefined ? '' : sized(svg);
}
