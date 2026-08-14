import path from 'node:path';
import { dirname, join } from 'pathe';

import type { Kaos } from '@pymodel/kaos';

import { collectGitContext } from '../session/git-context';
import { listDirectory } from '../tools/support/list-directory';
import type { AgentMemoryScope, SystemPromptContext } from './types';

const AGENTS_MD_MAX_BYTES = 32 * 1024;
const MEMORY_INDEX_MAX_LINES = 200;
const MEMORY_INDEX_MAX_BYTES = 25_000;
const AGENTS_MD_TRUNCATION_MARKER =
  '<!-- Some AGENTS.md files were truncated or omitted to fit the 32 KB budget -->';
const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

export type PreparedSystemPromptContext = Pick<
  SystemPromptContext,
  'cwdListing' | 'gitContext' | 'agentsMd'
> & {
  readonly agentMemoryPrompt?: string;
};

export interface AgentMemoryProfile {
  readonly name: string;
  readonly scope: AgentMemoryScope;
}

export async function prepareSystemPromptContext(
  kaos: Kaos,
  brandHome?: string,
  memory?: AgentMemoryProfile,
  includeGitContext = false,
  onInstructionsLoaded?: (path: string, memoryType: 'User' | 'Project') => void,
): Promise<PreparedSystemPromptContext> {
  const [cwdListing, agentsMd, agentMemoryPrompt, gitContext] = await Promise.all([
    listDirectory(kaos, undefined, { collapseHiddenDirs: true }),
    loadAgentsMd(kaos, brandHome, onInstructionsLoaded),
    memory === undefined
      ? undefined
      : loadAgentMemoryPrompt(kaos, memory.name, memory.scope, brandHome),
    includeGitContext ? collectGitContext(kaos, kaos.getcwd()) : undefined,
  ]);
  return { cwdListing, agentsMd, agentMemoryPrompt, gitContext };
}

export function getAgentMemoryDirectory(
  kaos: Kaos,
  agentName: string,
  scope: AgentMemoryScope,
  brandHome?: string,
): string {
  const pathApi = kaos.pathClass() === 'win32' ? path.win32 : path.posix;
  const directoryName =
    agentName
      .replaceAll(/[^a-zA-Z0-9._-]+/gu, '-')
      .replaceAll(/^\.+|\.+$/gu, '') || 'agent';
  switch (scope) {
    case 'user':
      return pathApi.join(
        brandHome ?? pathApi.join(kaos.gethome(), '.pythinker-code'),
        'agent-memory',
        directoryName,
      );
    case 'project':
      return pathApi.join(
        kaos.getcwd(),
        '.pythinker-code',
        'agent-memory',
        directoryName,
      );
    case 'local':
      return pathApi.join(
        kaos.getcwd(),
        '.pythinker-code',
        'agent-memory-local',
        directoryName,
      );
  }
}

export async function loadAgentMemoryPrompt(
  kaos: Kaos,
  agentName: string,
  scope: AgentMemoryScope,
  brandHome?: string,
): Promise<string> {
  const pathApi = kaos.pathClass() === 'win32' ? path.win32 : path.posix;
  const directory = getAgentMemoryDirectory(kaos, agentName, scope, brandHome);
  await kaos.mkdir(directory, { parents: true, existOk: true }).catch(() => {});

  let index = '';
  try {
    index = truncateMemoryIndex(
      await kaos.readText(pathApi.join(directory, 'MEMORY.md'), { errors: 'ignore' }),
    );
  } catch {
    // A missing or unreadable index is an empty memory; Write surfaces real
    // filesystem errors if the agent later tries to persist one.
  }

  const scopeDescription =
    scope === 'user'
      ? 'user-scoped across projects'
      : scope === 'project'
        ? 'project-scoped and suitable for shared repository knowledge'
        : 'local-scoped to this project and machine';
  return [
    '# Persistent Agent Memory',
    '',
    `Your ${scopeDescription} memory directory is \`${directory}\`.`,
    'Use Read to inspect topic files and Write or Edit to maintain them.',
    'Keep MEMORY.md as a concise index of topic files, not as the memory body itself.',
    'Store each topic as user, feedback, project, or reference memory:',
    '- user: the user role, goals, responsibilities, knowledge, and durable preferences.',
    '- feedback: corrections or confirmed approaches that should guide future collaboration.',
    '- project: non-derivable goals, incidents, decisions, owners, deadlines, and rationale.',
    '- reference: pointers to authoritative information in external systems.',
    'Start each topic file with `name`, `description`, and `type` frontmatter, using `type: <user|feedback|project|reference>`.',
    'Do not save code patterns, architecture, file paths, Git history, current-task state, or instructions already present in AGENTS.md; inspect the live project instead.',
    'Memory is a point-in-time observation. Before relying on a remembered file, function, flag, or current-state claim, verify it against the current source.',
    'Update or remove stale entries instead of creating duplicates.',
    '',
    '## Current MEMORY.md',
    index === '' ? '(empty)' : index,
  ].join('\n');
}

export async function loadAgentsMd(
  kaos: Kaos,
  brandHome?: string,
  onLoaded?: (path: string, memoryType: 'User' | 'Project') => void,
): Promise<string> {
  const workDir = kaos.getcwd();
  const projectRoot = await findProjectRoot(kaos, workDir);
  const dirs = dirsRootToLeaf(kaos, workDir, projectRoot);
  const discovered: AgentFile[] = [];
  const seen = new Set<string>();

  const collect = async (
    path: string,
    memoryType: 'User' | 'Project',
  ): Promise<boolean> => {
    const file = await readAgentFile(kaos, path);
    if (file === undefined) return false;
    const key = kaos.normpath(file.path);
    if (seen.has(key)) return false;
    seen.add(key);
    discovered.push(file);
    onLoaded?.(file.path, memoryType);
    return true;
  };

  // User-level files come first so any project-level AGENTS.md overrides them.
  // The brand dir follows PYTHINKER_CODE_HOME (default ~/.pythinker-code); the generic
  // .agents dir stays under the real OS home so it can be shared across tools.
  const realHome = kaos.gethome();
  const brandDir = brandHome ?? join(realHome, '.pythinker-code');
  await collect(join(brandDir, 'AGENTS.md'), 'User');

  // Generic user-level dir (.agents) matches skill discovery.
  const genericDirs = [join(realHome, '.agents')];
  const genericFiles = genericDirs.flatMap((dir) =>
    ['AGENTS.md', 'agents.md'].map((name) => join(dir, name)),
  );
  for (const file of genericFiles) {
    if (await collect(file, 'User')) break;
  }

  for (const dir of dirs) {
    await collect(join(dir, '.pythinker-code', 'AGENTS.md'), 'Project');
    for (const fileName of ['AGENTS.md', 'agents.md']) {
      if (await collect(join(dir, fileName), 'Project')) break;
    }
  }

  return renderAgentFiles(discovered);
}

export async function loadNestedAgentsMd(
  kaos: Kaos,
  targetPath: string,
  loadedPaths: Set<string>,
  onLoaded?: (path: string, triggerPath: string) => void,
): Promise<string> {
  const pathApi = kaos.pathClass() === 'win32' ? path.win32 : path.posix;
  const workDir = pathApi.normalize(kaos.getcwd());
  const target = pathApi.resolve(workDir, targetPath);
  const relativeDir = pathApi.relative(workDir, pathApi.dirname(target));
  if (
    relativeDir === '' ||
    relativeDir === '..' ||
    relativeDir.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativeDir)
  ) {
    return '';
  }

  const discovered: AgentFile[] = [];
  const segments = relativeDir.split(pathApi.sep);
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const dir = pathApi.join(workDir, ...segments.slice(0, depth));
    const collect = async (candidate: string): Promise<boolean> => {
      const file = await readAgentFile(kaos, candidate);
      if (file === undefined) return false;
      const key = kaos.normpath(file.path);
      if (!loadedPaths.has(key)) {
        loadedPaths.add(key);
        discovered.push(file);
        onLoaded?.(file.path, target);
      }
      return true;
    };

    await collect(pathApi.join(dir, '.pythinker-code', 'AGENTS.md'));
    for (const fileName of ['AGENTS.md', 'agents.md']) {
      if (await collect(pathApi.join(dir, fileName))) break;
    }
  }

  return renderAgentFiles(discovered);
}

async function findProjectRoot(kaos: Kaos, workDir: string): Promise<string> {
  const initial = kaos.normpath(workDir);
  let current = initial;

  while (true) {
    if (await pathExists(kaos, join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return initial;
    current = parent;
  }
}

function dirsRootToLeaf(kaos: Kaos, workDir: string, projectRoot: string): string[] {
  const dirs: string[] = [];
  let current = kaos.normpath(workDir);

  while (true) {
    dirs.push(current);
    if (current === projectRoot) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return dirs.toReversed();
}

interface AgentFile {
  readonly path: string;
  readonly content: string;
}

async function readAgentFile(kaos: Kaos, path: string): Promise<AgentFile | undefined> {
  if (!(await isFile(kaos, path))) return undefined;
  const content = (await kaos.readText(path, { errors: 'ignore' })).trim();
  if (content.length === 0) return undefined;
  return { path, content };
}

async function pathExists(kaos: Kaos, path: string): Promise<boolean> {
  try {
    await kaos.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function isFile(kaos: Kaos, path: string): Promise<boolean> {
  try {
    const stat = await kaos.stat(path);
    return (stat.stMode & S_IFMT) === S_IFREG;
  } catch {
    return false;
  }
}

function renderAgentFiles(files: readonly AgentFile[]): string {
  if (files.length === 0) return '';

  let remaining = AGENTS_MD_MAX_BYTES;
  let didTruncate = false;
  const budgeted: Array<AgentFile | undefined> = Array.from({ length: files.length });

  for (let i = files.length - 1; i >= 0; i--) {
    const file = files[i];
    if (file === undefined) continue;

    const annotation = annotationFor(file.path);
    const separator = i < files.length - 1 ? '\n\n' : '';
    remaining -= byteLength(annotation) + byteLength(separator);
    if (remaining <= 0) {
      budgeted[i] = { path: file.path, content: '' };
      remaining = 0;
      didTruncate = true;
      continue;
    }

    let content = file.content;
    if (byteLength(content) > remaining) {
      content = truncateUtf8(content, remaining).trim();
      didTruncate = true;
    }
    remaining -= byteLength(content);
    budgeted[i] = { path: file.path, content };
  }

  const rendered = budgeted
    .filter((file): file is AgentFile => file !== undefined && file.content.length > 0)
    .map((file) => `${annotationFor(file.path)}${file.content}`)
    .join('\n\n');

  return didTruncate ? `${AGENTS_MD_TRUNCATION_MARKER}\n${rendered}` : rendered;
}

function truncateMemoryIndex(raw: string): string {
  const lines = raw.trim().split(/\r?\n/u);
  const wasLineTruncated = lines.length > MEMORY_INDEX_MAX_LINES;
  let content = lines.slice(0, MEMORY_INDEX_MAX_LINES).join('\n');
  const wasByteTruncated = byteLength(content) > MEMORY_INDEX_MAX_BYTES;
  if (wasByteTruncated) {
    content = truncateUtf8(content, MEMORY_INDEX_MAX_BYTES);
    const lastLineBreak = content.lastIndexOf('\n');
    if (lastLineBreak > 0) content = content.slice(0, lastLineBreak);
  }
  return wasLineTruncated || wasByteTruncated
    ? `${content}\n\n> WARNING: MEMORY.md is oversized. Only part of it was loaded.`
    : content;
}

function truncateUtf8(text: string, maxBytes: number): string {
  let result = text;
  while (byteLength(result) > maxBytes) {
    result = result.slice(0, -1);
  }
  return result;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function annotationFor(path: string): string {
  return `<!-- From: ${path} -->\n`;
}
