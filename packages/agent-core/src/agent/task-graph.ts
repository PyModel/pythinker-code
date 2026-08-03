import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'pathe';
import { z } from 'zod';

export const ProjectTaskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type ProjectTaskStatus = z.infer<typeof ProjectTaskStatusSchema>;

const ProjectTaskSchema = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  owner: z.string().optional(),
  status: ProjectTaskStatusSchema,
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const PersistedTaskGraphV1Schema = z.object({
  version: z.literal(1),
  highWaterMark: z.number().int().nonnegative(),
  tasks: z.array(ProjectTaskSchema),
});

const TaskScopeSchema = z.object({
  highWaterMark: z.number().int().nonnegative(),
  tasks: z.array(ProjectTaskSchema),
});

const PersistedTaskGraphSchema = z.union([
  PersistedTaskGraphV1Schema,
  z.object({
    version: z.literal(2),
    activeScope: z.string(),
    scopes: z.record(z.string(), TaskScopeSchema),
  }),
]);

export type ProjectTask = z.infer<typeof ProjectTaskSchema>;

export interface CreateProjectTask {
  readonly subject: string;
  readonly description: string;
  readonly activeForm?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateProjectTask {
  readonly subject?: string;
  readonly description?: string;
  readonly activeForm?: string;
  readonly status?: ProjectTaskStatus | 'deleted';
  readonly owner?: string;
  readonly metadata?: Record<string, unknown>;
  readonly addBlocks?: readonly string[];
  readonly addBlockedBy?: readonly string[];
}

export interface UpdatedProjectTask {
  readonly task: ProjectTask | null;
  readonly updatedFields: readonly string[];
}

interface TaskScope {
  highWaterMark: number;
  tasks: Map<string, ProjectTask>;
}

export class SessionTaskGraph {
  private readonly scopes = new Map<string, TaskScope>([
    ['session', { highWaterMark: 0, tasks: new Map() }],
  ]);
  private activeScope = 'session';
  private readonly ready: Promise<void>;
  private mutation = Promise.resolve();

  constructor(private readonly persistencePath?: string) {
    this.ready = this.load();
  }

  async list(): Promise<ProjectTask[]> {
    await this.ready;
    return [...this.scope.tasks.values()]
      .toSorted((left, right) => Number(left.id) - Number(right.id))
      .map(cloneTask);
  }

  async get(id: string): Promise<ProjectTask | null> {
    await this.ready;
    const task = this.scope.tasks.get(id);
    return task === undefined ? null : cloneTask(task);
  }

  useScope(name: string, options?: { readonly reset?: boolean }): Promise<void> {
    return this.mutate(async () => {
      const scopeName = name.trim();
      if (scopeName.length === 0) throw new Error('Task scope name must not be empty');
      if (options?.reset === true || !this.scopes.has(scopeName)) {
        this.scopes.set(scopeName, { highWaterMark: 0, tasks: new Map() });
      }
      this.activeScope = scopeName;
      await this.persist();
    });
  }

  deleteScope(name: string): Promise<void> {
    return this.mutate(async () => {
      if (name === 'session') throw new Error('The session task scope cannot be deleted');
      this.scopes.delete(name);
      this.activeScope = 'session';
      await this.persist();
    });
  }

  create(input: CreateProjectTask): Promise<ProjectTask> {
    return this.mutate(async () => {
      const scope = this.scope;
      scope.highWaterMark += 1;
      const task: ProjectTask = {
        id: String(scope.highWaterMark),
        subject: input.subject,
        description: input.description,
        activeForm: input.activeForm,
        status: 'pending',
        blocks: [],
        blockedBy: [],
        metadata: input.metadata === undefined ? undefined : structuredClone(input.metadata),
      };
      scope.tasks.set(task.id, task);
      await this.persist();
      return cloneTask(task);
    });
  }

  update(id: string, patch: UpdateProjectTask): Promise<UpdatedProjectTask> {
    return this.mutate(async () => {
      const task = this.requireTask(id);
      if (patch.status === 'deleted') {
        this.scope.tasks.delete(id);
        for (const other of this.scope.tasks.values()) {
          other.blocks = other.blocks.filter((taskId) => taskId !== id);
          other.blockedBy = other.blockedBy.filter((taskId) => taskId !== id);
        }
        await this.persist();
        return { task: null, updatedFields: ['deleted'] };
      }

      const updatedFields: string[] = [];
      updateString(task, 'subject', patch.subject, updatedFields);
      updateString(task, 'description', patch.description, updatedFields);
      updateString(task, 'activeForm', patch.activeForm, updatedFields);
      updateOwner(task, patch.owner, updatedFields);
      if (patch.status !== undefined && patch.status !== task.status) {
        task.status = patch.status;
        updatedFields.push('status');
      }
      if (patch.metadata !== undefined) {
        const metadata = { ...task.metadata };
        for (const [key, value] of Object.entries(patch.metadata)) {
          if (value === null) delete metadata[key];
          else metadata[key] = structuredClone(value);
        }
        task.metadata = Object.keys(metadata).length === 0 ? undefined : metadata;
        updatedFields.push('metadata');
      }

      const addBlocks = unique(patch.addBlocks);
      const addBlockedBy = unique(patch.addBlockedBy);
      this.validateEdges(id, addBlocks, addBlockedBy);
      for (const blockedId of addBlocks) {
        if (task.blocks.includes(blockedId)) continue;
        this.addEdge(id, blockedId);
        if (!updatedFields.includes('blocks')) updatedFields.push('blocks');
      }
      for (const blockerId of addBlockedBy) {
        if (task.blockedBy.includes(blockerId)) continue;
        this.addEdge(blockerId, id);
        if (!updatedFields.includes('blockedBy')) updatedFields.push('blockedBy');
      }

      if (updatedFields.length > 0) await this.persist();
      return { task: cloneTask(task), updatedFields };
    });
  }

  private validateEdges(
    taskId: string,
    addBlocks: readonly string[],
    addBlockedBy: readonly string[],
  ): void {
    for (const blockedId of addBlocks) {
      this.requireTask(blockedId);
      this.assertEdgeAllowed(taskId, blockedId);
    }
    for (const blockerId of addBlockedBy) {
      this.requireTask(blockerId);
      this.assertEdgeAllowed(blockerId, taskId);
    }
  }

  private assertEdgeAllowed(blockerId: string, blockedId: string): void {
    if (blockerId === blockedId || this.reaches(blockedId, blockerId)) {
      throw new Error(
        `Cannot add task dependency ${blockerId} -> ${blockedId}: dependency cycle detected`,
      );
    }
  }

  private reaches(fromId: string, targetId: string): boolean {
    const pending = [fromId];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === targetId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...this.requireTask(current).blocks);
    }
    return false;
  }

  private addEdge(blockerId: string, blockedId: string): void {
    const blocker = this.requireTask(blockerId);
    const blocked = this.requireTask(blockedId);
    blocker.blocks.push(blockedId);
    blocked.blockedBy.push(blockerId);
  }

  private requireTask(id: string): ProjectTask {
    const task = this.scope.tasks.get(id);
    if (task === undefined) throw new Error(`Task #${id} not found`);
    return task;
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(async () => {
      await this.ready;
      return operation();
    });
    this.mutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<void> {
    if (this.persistencePath === undefined) return;
    let text: string;
    try {
      text = await readFile(this.persistencePath, 'utf-8');
    } catch (error) {
      if (isFileNotFound(error)) return;
      throw error;
    }
    const parsed = PersistedTaskGraphSchema.parse(JSON.parse(text) as unknown);
    this.scopes.clear();
    if (parsed.version === 1) {
      this.scopes.set('session', {
        highWaterMark: parsed.highWaterMark,
        tasks: new Map(parsed.tasks.map((task) => [task.id, cloneTask(task)])),
      });
      return;
    }
    this.activeScope = parsed.activeScope;
    for (const [name, scope] of Object.entries(parsed.scopes)) {
      this.scopes.set(name, {
        highWaterMark: scope.highWaterMark,
        tasks: new Map(scope.tasks.map((task) => [task.id, cloneTask(task)])),
      });
    }
    if (!this.scopes.has('session')) {
      this.scopes.set('session', { highWaterMark: 0, tasks: new Map() });
    }
    if (!this.scopes.has(this.activeScope)) {
      this.activeScope = 'session';
    }
  }

  private async persist(): Promise<void> {
    if (this.persistencePath === undefined) return;
    await mkdir(dirname(this.persistencePath), { recursive: true });
    const temporaryPath = `${this.persistencePath}.tmp`;
    const data = {
      version: 2 as const,
      activeScope: this.activeScope,
      scopes: Object.fromEntries(
        [...this.scopes].map(([name, scope]) => [
          name,
          {
            highWaterMark: scope.highWaterMark,
            tasks: [...scope.tasks.values()],
          },
        ]),
      ),
    };
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    await rename(temporaryPath, this.persistencePath);
  }

  private get scope(): TaskScope {
    const scope = this.scopes.get(this.activeScope);
    if (scope === undefined) throw new Error(`Task scope "${this.activeScope}" was not found`);
    return scope;
  }
}

function cloneTask(task: ProjectTask): ProjectTask {
  return structuredClone(task);
}

function unique(values: readonly string[] | undefined): string[] {
  return values === undefined ? [] : [...new Set(values)];
}

function updateString<K extends 'subject' | 'description' | 'activeForm' | 'owner'>(
  task: ProjectTask,
  key: K,
  value: ProjectTask[K] | undefined,
  fields: string[],
): void {
  if (value === undefined || value === task[key]) return;
  task[key] = value;
  fields.push(key);
}

function updateOwner(task: ProjectTask, value: string | undefined, fields: string[]): void {
  if (value === undefined) return;
  const owner = value.length === 0 ? undefined : value;
  if (owner === task.owner) return;
  if (owner === undefined) delete task.owner;
  else task.owner = owner;
  fields.push('owner');
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
