import { createHash, randomUUID } from 'node:crypto';

import type { Kaos } from '@pymodel/kaos';
import { diffLines } from 'diff';
import { join } from 'pathe';

import { ErrorCodes, PythinkerError } from '#/errors';

const MAX_CHECKPOINTS = 100;
const FILE_MODE_MASK = 0o7777;

export interface FileCheckpointSummary {
  readonly id: string;
  readonly kind: 'user' | 'recovery';
  readonly createdAt: string;
  readonly prompt?: string;
  readonly complete: boolean;
  readonly changedPaths: readonly string[];
}

export interface FileCheckpointPathPreview {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly modeChanged: boolean;
}

export interface FileCheckpointPreview {
  readonly checkpointId: string;
  readonly complete: boolean;
  readonly paths: readonly FileCheckpointPathPreview[];
  readonly insertions: number;
  readonly deletions: number;
}

export interface RestoreFileCheckpointResult {
  readonly checkpointId: string;
  readonly recoveryCheckpointId: string;
  readonly restoredPaths: readonly string[];
  readonly deletedPaths: readonly string[];
}

interface PersistedCheckpoint {
  readonly id: string;
  readonly kind: 'user' | 'recovery';
  readonly createdAt: string;
  readonly prompt?: string;
}

type PersistedFileImage =
  | { readonly path: string; readonly absent: true }
  | {
      readonly path: string;
      readonly absent?: false;
      readonly blob: string;
      readonly mode: number;
    };

type LoadedFileImage =
  | { readonly path: string; readonly absent: true }
  | {
      readonly path: string;
      readonly absent?: false;
      readonly content: string;
      readonly mode: number;
    };

type ManifestEvent =
  | { readonly type: 'checkpoint'; readonly checkpoint: PersistedCheckpoint }
  | {
      readonly type: 'capture';
      readonly checkpointId: string;
      readonly image: PersistedFileImage;
    }
  | {
      readonly type: 'incomplete';
      readonly checkpointId: string;
      readonly path: string;
      readonly message: string;
    }
  | { readonly type: 'evict'; readonly checkpointId: string };

interface CheckpointState {
  readonly checkpoint: PersistedCheckpoint;
  readonly images: Map<string, PersistedFileImage>;
  readonly incompletePaths: Map<string, string>;
}

export class SessionFileCheckpointStore {
  private toolKaos: Kaos;
  private readonly persistenceKaos: Kaos;
  private readonly rootDir: string;
  private readonly manifestPath: string;
  private readonly blobsDir: string;
  private readonly checkpoints = new Map<string, CheckpointState>();
  private readonly order: string[] = [];
  private ready?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    toolKaos: Kaos,
    persistenceKaos: Kaos,
    sessionDir: string,
    private readonly onDiagnostic?: (message: string, error?: unknown) => void,
  ) {
    this.toolKaos = toolKaos;
    this.persistenceKaos = persistenceKaos;
    this.rootDir = join(sessionDir, 'file-checkpoints');
    this.manifestPath = join(this.rootDir, 'manifest.jsonl');
    this.blobsDir = join(this.rootDir, 'blobs');
  }

  setToolKaos(kaos: Kaos): void {
    this.toolKaos = kaos;
  }

  beginUserCheckpoint(prompt: string): Promise<string> {
    return this.enqueue(async () => {
      const state = await this.createCheckpoint('user', prompt);
      return state.checkpoint.id;
    });
  }

  capture(checkpointId: string, path: string): Promise<void> {
    return this.enqueue(async () => {
      const state = this.requireCheckpoint(checkpointId);
      if (state.checkpoint.kind !== 'user') {
        throw invalidCheckpoint(`Checkpoint "${checkpointId}" does not accept file captures.`);
      }
      await this.captureInto(state, path, false);
    });
  }

  list(): Promise<readonly FileCheckpointSummary[]> {
    return this.enqueue(() =>
      Promise.resolve(
        this.order.flatMap((id) => {
          const state = this.checkpoints.get(id);
          return state === undefined ? [] : [summaryOf(state)];
        }),
      ),
    );
  }

  preview(checkpointId: string): Promise<FileCheckpointPreview> {
    return this.enqueue(async () => {
      const images = this.resolveImages(checkpointId);
      const beforeImages = await this.loadImages(images);
      const paths: FileCheckpointPathPreview[] = [];
      let insertions = 0;
      let deletions = 0;

      for (const before of beforeImages) {
        const current = await this.readWorkspaceImage(before.path);
        const beforeText = before.absent === true ? '' : before.content;
        const currentText = current.absent === true ? '' : current.content;
        let pathInsertions = 0;
        let pathDeletions = 0;
        for (const change of diffLines(beforeText, currentText)) {
          if (change.added === true) pathInsertions += change.count ?? 0;
          if (change.removed === true) pathDeletions += change.count ?? 0;
        }
        const modeChanged =
          before.absent !== true &&
          current.absent !== true &&
          before.mode !== current.mode;
        if (
          before.absent === current.absent &&
          pathInsertions === 0 &&
          pathDeletions === 0 &&
          !modeChanged
        ) {
          continue;
        }
        paths.push({
          path: before.path,
          insertions: pathInsertions,
          deletions: pathDeletions,
          modeChanged,
        });
        insertions += pathInsertions;
        deletions += pathDeletions;
      }

      return {
        checkpointId,
        complete: true,
        paths,
        insertions,
        deletions,
      };
    });
  }

  restore(checkpointId: string): Promise<RestoreFileCheckpointResult> {
    return this.enqueue(async () => {
      const images = this.resolveImages(checkpointId);
      const beforeImages = await this.loadImages(images);
      const recovery = await this.createCheckpoint('recovery');

      try {
        for (const image of beforeImages) {
          await this.captureInto(recovery, image.path, true);
        }
      } catch (error) {
        throw invalidCheckpoint(
          `Cannot restore checkpoint "${checkpointId}" because the recovery checkpoint could not be captured.`,
          {
            checkpointId,
            recoveryCheckpointId: recovery.checkpoint.id,
          },
          error,
        );
      }

      const failures: FileFailure[] = [];
      const restoredPaths: string[] = [];
      const deletedPaths: string[] = [];
      for (const image of beforeImages) {
        try {
          await this.applyImage(image);
          if (image.absent === true) deletedPaths.push(image.path);
          else restoredPaths.push(image.path);
        } catch (error) {
          failures.push({ path: image.path, message: errorMessage(error) });
          break;
        }
      }

      if (failures.length > 0) {
        const rollbackFailures: FileFailure[] = [];
        try {
          const recoveryImages = await this.loadImages([
            ...recovery.images.values(),
          ]);
          for (const image of recoveryImages) {
            try {
              await this.applyImage(image);
            } catch (error) {
              rollbackFailures.push({
                path: image.path,
                message: errorMessage(error),
              });
            }
          }
        } catch (error) {
          rollbackFailures.push({
            path: this.rootDir,
            message: errorMessage(error),
          });
        }
        throw invalidCheckpoint(
          `Failed to restore checkpoint "${checkpointId}". Recovery checkpoint: ${recovery.checkpoint.id}.`,
          {
            checkpointId,
            recoveryCheckpointId: recovery.checkpoint.id,
            failures,
            rollbackFailures,
          },
        );
      }

      return {
        checkpointId,
        recoveryCheckpointId: recovery.checkpoint.id,
        restoredPaths,
        deletedPaths,
      };
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      this.ready ??= this.load();
      await this.ready;
      return operation();
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async load(): Promise<void> {
    await this.persistenceKaos.mkdir(this.rootDir, {
      parents: true,
      existOk: true,
    });
    await this.persistenceKaos.mkdir(this.blobsDir, {
      parents: true,
      existOk: true,
    });
    let content: string;
    try {
      content = await this.persistenceKaos.readText(this.manifestPath);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    const lines = content.split('\n');
    const lastLine = lines.findLastIndex((line) => line.trim().length > 0);
    for (let index = 0; index <= lastLine; index++) {
      const line = lines[index]?.trim();
      if (line === undefined || line.length === 0) continue;
      let event: ManifestEvent;
      try {
        event = parseManifestEvent(line);
      } catch (error) {
        if (index === lastLine && error instanceof SyntaxError) {
          this.onDiagnostic?.('Ignored an interrupted file-checkpoint manifest append.', error);
          break;
        }
        throw invalidCheckpoint(
          `File-checkpoint manifest is invalid at line ${String(index + 1)}.`,
          { line: index + 1 },
          error,
        );
      }
      this.replay(event);
    }
    await this.enforceRetention();
  }

  private replay(event: ManifestEvent): void {
    switch (event.type) {
      case 'checkpoint': {
        if (this.checkpoints.has(event.checkpoint.id)) return;
        this.checkpoints.set(event.checkpoint.id, {
          checkpoint: event.checkpoint,
          images: new Map(),
          incompletePaths: new Map(),
        });
        this.order.push(event.checkpoint.id);
        return;
      }
      case 'capture': {
        const state = this.checkpoints.get(event.checkpointId);
        if (state !== undefined && !state.images.has(event.image.path)) {
          state.images.set(event.image.path, event.image);
        }
        return;
      }
      case 'incomplete': {
        const state = this.checkpoints.get(event.checkpointId);
        state?.incompletePaths.set(event.path, event.message);
        return;
      }
      case 'evict':
        this.removeCheckpoint(event.checkpointId);
    }
  }

  private async createCheckpoint(
    kind: PersistedCheckpoint['kind'],
    prompt?: string,
  ): Promise<CheckpointState> {
    const checkpoint: PersistedCheckpoint = {
      id: `${kind}_${randomUUID()}`,
      kind,
      createdAt: new Date().toISOString(),
      prompt,
    };
    await this.append({ type: 'checkpoint', checkpoint });
    const state: CheckpointState = {
      checkpoint,
      images: new Map(),
      incompletePaths: new Map(),
    };
    this.checkpoints.set(checkpoint.id, state);
    this.order.push(checkpoint.id);
    await this.enforceRetention();
    return state;
  }

  private async enforceRetention(): Promise<void> {
    while (this.order.length > MAX_CHECKPOINTS) {
      const checkpointId = this.order[0];
      if (checkpointId === undefined) return;
      await this.append({ type: 'evict', checkpointId });
      this.removeCheckpoint(checkpointId);
    }
  }

  private removeCheckpoint(checkpointId: string): void {
    this.checkpoints.delete(checkpointId);
    const index = this.order.indexOf(checkpointId);
    if (index >= 0) this.order.splice(index, 1);
  }

  private async captureInto(
    state: CheckpointState,
    path: string,
    strict: boolean,
  ): Promise<void> {
    if (state.images.has(path) || state.incompletePaths.has(path)) return;
    try {
      const current = await this.readWorkspaceImage(path);
      let image: PersistedFileImage;
      if (current.absent === true) {
        image = current;
      } else {
        const blob = createHash('sha256').update(current.content).digest('hex');
        await this.persistenceKaos.writeText(join(this.blobsDir, blob), current.content);
        image = { path, blob, mode: current.mode };
      }
      await this.append({
        type: 'capture',
        checkpointId: state.checkpoint.id,
        image,
      });
      state.images.set(path, image);
    } catch (error) {
      const message = errorMessage(error);
      state.incompletePaths.set(path, message);
      try {
        await this.append({
          type: 'incomplete',
          checkpointId: state.checkpoint.id,
          path,
          message,
        });
      } catch (manifestError) {
        this.onDiagnostic?.(
          `Failed to persist incomplete file checkpoint ${state.checkpoint.id}.`,
          manifestError,
        );
      }
      this.onDiagnostic?.(
        `Failed to capture ${path} for file checkpoint ${state.checkpoint.id}.`,
        error,
      );
      if (strict) throw error;
    }
  }

  private resolveImages(checkpointId: string): readonly PersistedFileImage[] {
    const selected = this.requireCheckpoint(checkpointId);
    if (selected.checkpoint.kind === 'recovery') {
      this.assertComplete([selected]);
      return [...selected.images.values()];
    }

    const start = this.order.indexOf(checkpointId);
    const range = this.order
      .slice(start)
      .flatMap((id) => {
        const state = this.checkpoints.get(id);
        return state?.checkpoint.kind === 'user' ? [state] : [];
      });
    this.assertComplete(range);
    const images = new Map<string, PersistedFileImage>();
    for (const state of range) {
      for (const [path, image] of state.images) {
        if (!images.has(path)) images.set(path, image);
      }
    }
    return [...images.values()];
  }

  private assertComplete(states: readonly CheckpointState[]): void {
    const incomplete = states.flatMap((state) =>
      [...state.incompletePaths.keys()].map((path) => ({
        checkpointId: state.checkpoint.id,
        path,
      })),
    );
    if (incomplete.length === 0) return;
    throw invalidCheckpoint(
      'Cannot restore files because the required checkpoint history is incomplete.',
      { incomplete },
    );
  }

  private requireCheckpoint(checkpointId: string): CheckpointState {
    const state = this.checkpoints.get(checkpointId);
    if (state !== undefined) return state;
    throw invalidCheckpoint(`File checkpoint "${checkpointId}" was not found.`, {
      checkpointId,
    });
  }

  private async loadImages(
    images: readonly PersistedFileImage[],
  ): Promise<readonly LoadedFileImage[]> {
    return Promise.all(
      images.map(async (image): Promise<LoadedFileImage> => {
        if (image.absent === true) return image;
        try {
          return {
            path: image.path,
            content: await this.persistenceKaos.readText(
              join(this.blobsDir, image.blob),
            ),
            mode: image.mode,
          };
        } catch (error) {
          throw invalidCheckpoint(
            `Backup content for "${image.path}" is unavailable.`,
            { path: image.path, blob: image.blob },
            error,
          );
        }
      }),
    );
  }

  private async readWorkspaceImage(path: string): Promise<LoadedFileImage> {
    let before;
    try {
      before = await this.toolKaos.stat(path);
    } catch (error) {
      if (isNotFound(error)) return { path, absent: true };
      throw error;
    }
    const content = await this.toolKaos.readText(path, { errors: 'strict' });
    const after = await this.toolKaos.stat(path);
    if (
      before.stMtime !== after.stMtime ||
      before.stSize !== after.stSize ||
      before.stMode !== after.stMode
    ) {
      throw new Error(`File changed while its checkpoint image was being captured: ${path}`);
    }
    return {
      path,
      content,
      mode: before.stMode & FILE_MODE_MASK,
    };
  }

  private async applyImage(image: LoadedFileImage): Promise<void> {
    if (image.absent === true) {
      try {
        await this.toolKaos.unlink(image.path);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return;
    }
    await this.toolKaos.writeText(image.path, image.content);
    await this.toolKaos.chmod(image.path, image.mode);
  }

  private append(event: ManifestEvent): Promise<number> {
    return this.persistenceKaos.writeText(
      this.manifestPath,
      `${JSON.stringify(event)}\n`,
      { mode: 'a' },
    );
  }
}

interface FileFailure {
  readonly path: string;
  readonly message: string;
}

function summaryOf(state: CheckpointState): FileCheckpointSummary {
  return {
    ...state.checkpoint,
    complete: state.incompletePaths.size === 0,
    changedPaths: [
      ...new Set([
        ...state.images.keys(),
        ...state.incompletePaths.keys(),
      ]),
    ],
  };
}

function invalidCheckpoint(
  message: string,
  details?: Record<string, unknown>,
  cause?: unknown,
): PythinkerError {
  return new PythinkerError(ErrorCodes.REQUEST_INVALID, message, {
    details,
    cause,
  });
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate.code === 'ENOENT' ||
    candidate.code === 2 ||
    candidate.name === 'KaosFileNotFoundError'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseManifestEvent(line: string): ManifestEvent {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value) || typeof value['type'] !== 'string') {
    throw new TypeError('Manifest event must be an object with a type.');
  }
  switch (value['type']) {
    case 'checkpoint': {
      const checkpoint = value['checkpoint'];
      if (
        !isRecord(checkpoint) ||
        typeof checkpoint['id'] !== 'string' ||
        (checkpoint['kind'] !== 'user' && checkpoint['kind'] !== 'recovery') ||
        typeof checkpoint['createdAt'] !== 'string' ||
        (checkpoint['prompt'] !== undefined &&
          typeof checkpoint['prompt'] !== 'string')
      ) {
        throw new TypeError('Checkpoint event is invalid.');
      }
      return {
        type: 'checkpoint',
        checkpoint: {
          id: checkpoint['id'],
          kind: checkpoint['kind'],
          createdAt: checkpoint['createdAt'],
          prompt: checkpoint['prompt'],
        },
      };
    }
    case 'capture': {
      const image = value['image'];
      if (
        typeof value['checkpointId'] !== 'string' ||
        !isRecord(image) ||
        typeof image['path'] !== 'string'
      ) {
        throw new TypeError('Capture event is invalid.');
      }
      if (image['absent'] === true) {
        return {
          type: 'capture',
          checkpointId: value['checkpointId'],
          image: { path: image['path'], absent: true },
        };
      }
      if (typeof image['blob'] !== 'string' || typeof image['mode'] !== 'number') {
        throw new TypeError('Capture image is invalid.');
      }
      return {
        type: 'capture',
        checkpointId: value['checkpointId'],
        image: {
          path: image['path'],
          blob: image['blob'],
          mode: image['mode'],
        },
      };
    }
    case 'incomplete':
      if (
        typeof value['checkpointId'] !== 'string' ||
        typeof value['path'] !== 'string' ||
        typeof value['message'] !== 'string'
      ) {
        throw new TypeError('Incomplete event is invalid.');
      }
      return {
        type: 'incomplete',
        checkpointId: value['checkpointId'],
        path: value['path'],
        message: value['message'],
      };
    case 'evict':
      if (typeof value['checkpointId'] !== 'string') {
        throw new TypeError('Eviction event is invalid.');
      }
      return { type: 'evict', checkpointId: value['checkpointId'] };
    default:
      throw new TypeError(`Unknown manifest event type: ${value['type']}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
