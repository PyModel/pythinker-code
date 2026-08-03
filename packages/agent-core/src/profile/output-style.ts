import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'pathe';

import { parseFrontmatter } from '../skill/parser';
import type { PluginOutputStyleSource } from '../plugin/types';

export const DEFAULT_OUTPUT_STYLE_NAME = 'default';

export type OutputStyleSource = 'built-in' | 'plugin' | 'user' | 'project';

export interface OutputStyleConfig {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly source: OutputStyleSource;
  readonly keepCodingInstructions?: boolean;
  readonly forceForPlugin?: boolean;
}

export type OutputStyles = Readonly<Record<string, OutputStyleConfig | null>>;

export interface OutputStyleLoadResult {
  readonly styles: OutputStyles;
  readonly failures: ReadonlyArray<{ readonly path: string; readonly error: string }>;
}

const INSIGHTS = [
  'Before and after writing code, provide brief educational explanations about implementation choices.',
  'Focus insights on the current codebase and the change being made, not generic programming concepts.',
].join(' ');

export const BUILTIN_OUTPUT_STYLES: OutputStyles = {
  [DEFAULT_OUTPUT_STYLE_NAME]: null,
  Explanatory: {
    name: 'Explanatory',
    source: 'built-in',
    description: 'Explain implementation choices and codebase patterns.',
    keepCodingInstructions: true,
    prompt: [
      'Be clear and educational while remaining focused on completing the task.',
      INSIGHTS,
    ].join('\n\n'),
  },
  Learning: {
    name: 'Learning',
    source: 'built-in',
    description: 'Pause for small hands-on coding contributions.',
    keepCodingInstructions: true,
    prompt: [
      'Help the user learn through hands-on practice while completing the task.',
      'For a meaningful design decision in a change of at least 20 lines, leave exactly one TODO(human) and ask the user to implement a focused 2-10 line contribution. Stop and wait after making that request.',
      INSIGHTS,
    ].join('\n\n'),
  },
};

export async function loadOutputStyles(input: {
  readonly brandHome: string;
  readonly workDir: string;
  readonly pluginSources?: readonly PluginOutputStyleSource[];
}): Promise<OutputStyleLoadResult> {
  const styles: Record<string, OutputStyleConfig | null> = { ...BUILTIN_OUTPUT_STYLES };
  const failures: Array<{ path: string; error: string }> = [];

  for (const source of input.pluginSources ?? []) {
    for (const declaredPath of source.paths) {
      await loadPath(declaredPath, 'plugin', styles, failures, source.pluginId);
    }
  }
  await loadPath(join(input.brandHome, 'output-styles'), 'user', styles, failures);
  for (const directory of await projectOutputStyleDirectories(input.workDir)) {
    await loadPath(directory, 'project', styles, failures);
  }

  return { styles, failures };
}

export function resolveOutputStyle(
  styles: OutputStyles,
  configuredName = DEFAULT_OUTPUT_STYLE_NAME,
): OutputStyleConfig | null {
  const forced = Object.values(styles).find(
    (style) => style?.source === 'plugin' && style.forceForPlugin === true,
  );
  return forced ?? styles[configuredName] ?? null;
}

async function loadPath(
  declaredPath: string,
  source: Exclude<OutputStyleSource, 'built-in'>,
  styles: Record<string, OutputStyleConfig | null>,
  failures: Array<{ path: string; error: string }>,
  pluginId?: string,
): Promise<void> {
  let files: readonly string[];
  try {
    files = await markdownFiles(declaredPath);
  } catch (error) {
    if (isFileNotFound(error)) return;
    failures.push({ path: declaredPath, error: errorMessage(error) });
    return;
  }

  for (const file of files) {
    try {
      const style = parseOutputStyle(await readFile(file, 'utf8'), file, source, pluginId);
      styles[style.name] = style;
    } catch (error) {
      failures.push({ path: file, error: errorMessage(error) });
    }
  }
}

async function markdownFiles(path: string): Promise<readonly string[]> {
  const details = await stat(path);
  if (details.isFile()) return extname(path).toLowerCase() === '.md' ? [path] : [];
  if (!details.isDirectory()) return [];
  const files: string[] = [];
  await walkMarkdownFiles(path, files);
  return files.toSorted();
}

async function walkMarkdownFiles(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownFiles(path, files);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(path);
    }
  }
}

async function projectOutputStyleDirectories(workDir: string): Promise<readonly string[]> {
  const initial = resolve(workDir);
  let root = initial;
  let current = initial;
  while (true) {
    if (await pathExists(join(current, '.git'))) {
      root = current;
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const directories: string[] = [];
  current = initial;
  while (true) {
    directories.push(join(current, '.pythinker-code', 'output-styles'));
    if (current === root) break;
    current = dirname(current);
  }
  return directories.toReversed();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function parseOutputStyle(
  text: string,
  path: string,
  source: Exclude<OutputStyleSource, 'built-in'>,
  pluginId?: string,
): OutputStyleConfig {
  const parsed = parseFrontmatter(text);
  const frontmatter = isRecord(parsed.data) ? parsed.data : {};
  const stem = basename(path, extname(path));
  const rawName = nonEmptyString(frontmatter['name']) ?? stem;
  const name = pluginId === undefined ? rawName : `${pluginId}:${rawName}`;
  const prompt = parsed.body.trim();
  if (prompt.length === 0) throw new Error('Output style prompt is empty');
  const description =
    nonEmptyString(frontmatter['description']) ??
    prompt.split(/\r?\n/u).find((line) => line.trim().length > 0)?.trim() ??
    `Custom ${rawName} output style`;
  const keepCodingInstructions = optionalBoolean(frontmatter['keep-coding-instructions']);
  const forceForPlugin =
    source === 'plugin' ? optionalBoolean(frontmatter['force-for-plugin']) : undefined;

  return {
    name,
    description,
    prompt,
    source,
    keepCodingInstructions,
    forceForPlugin,
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
