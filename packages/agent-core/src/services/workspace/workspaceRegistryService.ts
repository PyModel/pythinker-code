

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Stats } from 'node:fs';

import { Disposable, InstantiationType, registerSingleton } from '../../di';
import { encodeWorkDirKey, normalizeWorkDir, workspaceRootKey } from '../../session/store';
import { readSessionIndex } from '../../session/store/session-index';
import { IEnvironmentService } from '../environment/environment';
import { IEventService } from '../event/event';

import type { Workspace } from '@pythoughts/protocol';

import { ILogService } from '../logger/logger';
import {
  IWorkspaceRegistry,
  WorkspaceNotFoundError,
  WorkspaceRootNotFoundError,
  type WorkspacePatch,
} from './workspaceRegistry';

const WORKSPACE_REGISTRY_FILE = 'workspaces.json';
const WORKSPACE_REGISTRY_VERSION = 1;

interface WorkspaceRegistryEntry {
  root: string;
  name: string;
  created_at: string;
  last_opened_at: string;
}

interface WorkspaceRegistryFile {
  version: number;
  workspaces: Record<string, WorkspaceRegistryEntry>;
}

export function findRegisteredIdByRootKey(
  workspaces: Record<string, WorkspaceRegistryEntry>,
  rootKey: string,
  preferredId?: string,
): string | undefined {
  let first: string | undefined;
  for (const [id, entry] of Object.entries(workspaces)) {
    if (workspaceRootKey(entry.root) !== rootKey) continue;
    if (id === preferredId) return id;
    first ??= id;
  }
  return first;
}

type WorkspaceRegistryEvent =
  | { type: 'event.workspace.created'; workspace: Workspace }
  | { type: 'event.workspace.updated'; workspace: Workspace }
  | { type: 'event.workspace.deleted'; workspace_id: string; root: string };

export class WorkspaceRegistryService extends Disposable implements IWorkspaceRegistry {
  readonly _serviceBrand: undefined;

  private readonly homeDir: string;
  private readonly sessionsDir: string;
  private readonly registryPath: string;
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(
    @IEnvironmentService env: IEnvironmentService,
    @ILogService private readonly logger: ILogService,
    @IEventService private readonly eventService: IEventService,
  ) {
    super();
    this.homeDir = env.homeDir;
    this.sessionsDir = join(env.homeDir, 'sessions');
    this.registryPath = join(env.homeDir, WORKSPACE_REGISTRY_FILE);
  }

  async list(): Promise<Workspace[]> {
    const file = await this.runExclusive(() => this.readRegistry());
    const byRoot = new Map<string, { id: string; entry: WorkspaceRegistryEntry }>();
    for (const [id, entry] of Object.entries(file.workspaces)) {
      const key = workspaceRootKey(entry.root);
      const existing = byRoot.get(key);
      if (existing === undefined) {
        byRoot.set(key, { id, entry });
        continue;
      }
      const canonicalId = encodeWorkDirKey(normalizeWorkDir(entry.root));
      if (existing.id !== canonicalId && id === canonicalId) {
        byRoot.set(key, { id, entry });
      }
    }
    const hydrated = await Promise.all(
      [...byRoot.values()].map(({ id, entry }) =>
        this.hydrate(id, entry),
      ),
    );
    return hydrated.sort((a, b) => (b.last_opened_at < a.last_opened_at ? -1 : 1));
  }

  async get(workspaceId: string): Promise<Workspace> {
    const entry = await this.runExclusive(async () => {
      const file = await this.readRegistry();
      return file.workspaces[workspaceId] ?? null;
    });
    if (entry === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return this.hydrate(workspaceId, entry);
  }

  async createOrTouch(root: string, name?: string): Promise<Workspace> {
    let stat: Stats;
    try {
      stat = await fsp.stat(root);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new WorkspaceRootNotFoundError(root);
      }
      throw err;
    }
    if (!stat.isDirectory()) {
      throw new WorkspaceRootNotFoundError(root);
    }
    const normalizedRoot = normalizeWorkDir(root);

    const now = new Date().toISOString();
    const { workspaceId, entry, created } = await this.runExclusive(async () => {
      const file = await this.readRegistry();
      const mintedId = encodeWorkDirKey(normalizedRoot);
      const workspaceId =
        findRegisteredIdByRootKey(file.workspaces, workspaceRootKey(normalizedRoot), mintedId) ??
        mintedId;
      const existing = file.workspaces[workspaceId];
      const next: WorkspaceRegistryEntry =
        existing !== undefined
          ? { ...existing, last_opened_at: now }
          : {
              root: normalizedRoot,
              name: name ?? basename(normalizedRoot),
              created_at: now,
              last_opened_at: now,
            };
      file.workspaces[workspaceId] = next;
      await this.writeRegistry(file);
      return { workspaceId, entry: next, created: existing === undefined };
    });
    await fsp.mkdir(join(this.sessionsDir, workspaceId), { recursive: true, mode: 0o700 });
    const workspace = await this.hydrate(workspaceId, entry);
    if (created) {
      this.publishWorkspace({ type: 'event.workspace.created', workspace });
    }
    return workspace;
  }

  async update(workspaceId: string, patch: WorkspacePatch): Promise<Workspace> {
    const entry = await this.runExclusive(async () => {
      const file = await this.readRegistry();
      const existing = file.workspaces[workspaceId];
      if (existing === undefined) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      const next: WorkspaceRegistryEntry = {
        ...existing,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
      };
      file.workspaces[workspaceId] = next;
      await this.writeRegistry(file);
      return next;
    });
    const workspace = await this.hydrate(workspaceId, entry);
    this.publishWorkspace({ type: 'event.workspace.updated', workspace });
    return workspace;
  }

  async delete(workspaceId: string): Promise<void> {
    const root = await this.runExclusive(async () => {
      const file = await this.readRegistry();
      const existing = file.workspaces[workspaceId];
      if (existing === undefined) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      const rootKey = workspaceRootKey(existing.root);
      for (const [id, entry] of Object.entries(file.workspaces)) {
        if (workspaceRootKey(entry.root) === rootKey) delete file.workspaces[id];
      }
      await this.writeRegistry(file);
      return existing.root;
    });
    this.publishWorkspace({
      type: 'event.workspace.deleted',
      workspace_id: workspaceId,
      root,
    });
  }

  async resolveRoot(workspaceId: string): Promise<string> {
    const entry = await this.runExclusive(async () => {
      const file = await this.readRegistry();
      return file.workspaces[workspaceId] ?? null;
    });
    if (entry === null) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return entry.root;
  }

  async findWorkspaceIdByRoot(root: string): Promise<string | undefined> {
    return this.runExclusive(async () => {
      const file = await this.readRegistry();
      return findRegisteredIdByRootKey(
        file.workspaces,
        workspaceRootKey(root),
        encodeWorkDirKey(root),
      );
    });
  }

  async resolveAliasWorkDirs(workspaceId: string): Promise<readonly string[]> {
    return (await this.aliasLayout(workspaceId))?.aliases ?? [];
  }

  private async aliasLayout(
    workspaceId: string,
  ): Promise<{ aliases: readonly string[]; buckets: readonly string[] } | undefined> {
    const [file, index] = await Promise.all([
      this.runExclusive(() => this.readRegistry()),
      readSessionIndex(this.homeDir, this.sessionsDir),
    ]);
    const root = file.workspaces[workspaceId]?.root;
    if (root === undefined) return undefined;
    const rootKey = workspaceRootKey(root);
    const aliases = new Set<string>([root]);
    const buckets = new Set<string>();
    for (const [id, entry] of Object.entries(file.workspaces)) {
      if (workspaceRootKey(entry.root) !== rootKey) continue;
      aliases.add(entry.root);
      buckets.add(id);
    }
    for (const entry of index.values()) {
      if (workspaceRootKey(entry.workDir) === rootKey) aliases.add(entry.workDir);
    }
    for (const dir of aliases) {
      buckets.add(encodeWorkDirKey(normalizeWorkDir(dir)));
    }
    return { aliases: [...aliases].toSorted(), buckets: [...buckets] };
  }

  private async hydrate(
    workspaceId: string,
    entry: WorkspaceRegistryEntry,
  ): Promise<Workspace> {
    const layout = await this.aliasLayout(workspaceId);
    const sessionCounts = await Promise.all(
      (layout?.buckets ?? [workspaceId]).map((id) =>
        countSessionDirs(join(this.sessionsDir, id)),
      ),
    );
      const { is_git_repo, branch } = await detectGit(entry.root);
    const session_count = sessionCounts.reduce((sum, count) => sum + count, 0);
    return {
      id: workspaceId,
      root: entry.root,
      name: entry.name,
      is_git_repo,
      branch,
      created_at: entry.created_at,
      last_opened_at: entry.last_opened_at,
      session_count,
    };
  }

  private publishWorkspace(event: WorkspaceRegistryEvent): void {
    switch (event.type) {
      case 'event.workspace.created':
      case 'event.workspace.updated':
        this.eventService.publish({
          agentId: 'main',
          sessionId: '__global__',
          type: event.type,
          workspace: event.workspace,
        });
        break;
      case 'event.workspace.deleted':
        this.eventService.publish({
          agentId: 'main',
          sessionId: '__global__',
          type: event.type,
          workspace_id: event.workspace_id,
          root: event.root,
        });
        break;
    }
  }

  private async readRegistry(): Promise<WorkspaceRegistryFile> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.registryPath, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        return { version: WORKSPACE_REGISTRY_VERSION, workspaces: {} };
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger.warn(
        { path: this.registryPath, err: String(err) },
        'workspaces.json malformed; treating as empty',
      );
      return { version: WORKSPACE_REGISTRY_VERSION, workspaces: {} };
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { workspaces?: unknown }).workspaces !== 'object' ||
      (parsed as { workspaces?: unknown }).workspaces === null
    ) {
      this.logger.warn(
        { path: this.registryPath },
        'workspaces.json missing required keys; treating as empty',
      );
      return { version: WORKSPACE_REGISTRY_VERSION, workspaces: {} };
    }
    const rawWorkspaces = (parsed as { workspaces: Record<string, unknown> }).workspaces;
    const workspaces: Record<string, WorkspaceRegistryEntry> = {};
    for (const [id, value] of Object.entries(rawWorkspaces)) {
      const entry = this.sanitizeEntry(value);
      if (entry !== null) {
        workspaces[id] = entry;
      }
    }
    const version =
      typeof (parsed as { version?: unknown }).version === 'number'
        ? (parsed as { version: number }).version
        : WORKSPACE_REGISTRY_VERSION;
    return { version, workspaces };
  }

  private sanitizeEntry(value: unknown): WorkspaceRegistryEntry | null {
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Partial<WorkspaceRegistryEntry>;
    if (
      typeof v.root !== 'string' ||
      typeof v.name !== 'string' ||
      typeof v.created_at !== 'string' ||
      typeof v.last_opened_at !== 'string'
    ) {
      return null;
    }
    return {
      root: v.root,
      name: v.name,
      created_at: v.created_at,
      last_opened_at: v.last_opened_at,
    };
  }

  private async writeRegistry(file: WorkspaceRegistryFile): Promise<void> {
    await fsp.mkdir(dirname(this.registryPath), { recursive: true, mode: 0o700 });
    const tmp = `${this.registryPath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
    await fsp.rename(tmp, this.registryPath);
  }

  private runExclusive<T>(op: () => Promise<T>): Promise<T> {
    const next = this.opQueue.then(op, op);
    this.opQueue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  override dispose(): void {
    if (this._store.isDisposed) return;
    super.dispose();
  }
}

export interface GitInfo {
  is_git_repo: boolean;
  branch: string | null;
}

export async function detectGit(root: string): Promise<GitInfo> {
  let dotGit: Stats;
  try {
    dotGit = await fsp.lstat(join(root, '.git'));
  } catch {
    return { is_git_repo: false, branch: null };
  }

  let gitDir: string;
  if (dotGit.isDirectory()) {
    gitDir = join(root, '.git');
  } else if (dotGit.isFile()) {
    let text: string;
    try {
      text = await fsp.readFile(join(root, '.git'), 'utf8');
    } catch {
      return { is_git_repo: false, branch: null };
    }
    const m = /^gitdir:\s*(.+)$/m.exec(text);
    if (m === null) return { is_git_repo: false, branch: null };
    const ref = m[1] ?? '';
    if (ref === '') return { is_git_repo: false, branch: null };
    gitDir = ref.trim();

    if (!gitDir.startsWith('/')) {
      gitDir = join(root, gitDir);
    }
  } else {
    return { is_git_repo: false, branch: null };
  }

  let head: string;
  try {
    head = (await fsp.readFile(join(gitDir, 'HEAD'), 'utf8')).trim();
  } catch {
    return { is_git_repo: true, branch: null };
  }
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
  return { is_git_repo: true, branch: ref ? (ref[1] ?? null) : null };
}

async function countSessionDirs(dir: string): Promise<number> {
  let dirents;
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 0;
    throw err;
  }
  let count = 0;
  for (const d of dirents) {
    if (d.isDirectory()) count += 1;
  }
  return count;
}

export function userHomeDir(): string {
  return os.homedir();
}

export const pathDirname = dirname;

registerSingleton(IWorkspaceRegistry, WorkspaceRegistryService, InstantiationType.Delayed);
