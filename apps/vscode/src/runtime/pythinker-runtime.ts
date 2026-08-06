import {
  createPythinkerHarness,
  type PermissionMode,
  type PythinkerHarness,
  type Session,
  type SessionSummary,
} from "@pythoughts/pythinker-code-sdk";

import type { RuntimeBroadcast } from "./session-runtime";
import {
  defaultPermissionMode,
  permissionModeMetadata,
  persistPermissionMode,
  readPermissionMode,
  type PermissionModeTarget,
} from "./permission-mode";
import { SessionRuntime } from "./session-runtime";
import { areSameFsPath } from "../utils/fs-path";

export interface PythinkerRuntimeOptions {
  readonly version: string;
  readonly broadcast: RuntimeBroadcast;
  readonly captureBaseline: (
    session: Pick<SessionSummary, "id" | "workDir" | "metadata">,
    filePath: string,
    webviewIds: readonly string[],
  ) => void;
  readonly log: (message: string, error?: unknown) => void;
  readonly homeDir?: string;
  readonly harness?: PythinkerHarness;
}

export interface OpenSessionOptions {
  readonly webviewId: string;
  readonly workDir: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly effort: string;
  readonly yoloMode: boolean;
}

/** Extension-host owner for one in-process Node SDK harness. */
export class PythinkerRuntime {
  readonly harness: PythinkerHarness;

  private readonly broadcast: RuntimeBroadcast;
  private readonly captureBaseline: PythinkerRuntimeOptions["captureBaseline"];
  private readonly log: PythinkerRuntimeOptions["log"];
  private readonly sessions = new Map<string, SessionRuntime>();
  private readonly sessionByView = new Map<string, string>();
  private readonly pendingPermissionByView = new Map<string, PermissionMode>();
  private closed = false;

  constructor(options: PythinkerRuntimeOptions) {
    this.broadcast = options.broadcast;
    this.captureBaseline = options.captureBaseline;
    this.log = options.log;
    this.harness =
      options.harness ??
      createPythinkerHarness({
        ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
        identity: {
          userAgentProduct: "pythinker-code-vscode",
          version: options.version,
        },
        uiMode: "vscode",
      });
  }

  getSessionForView(webviewId: string): SessionRuntime | undefined {
    const id = this.sessionByView.get(webviewId);
    return id === undefined ? undefined : this.sessions.get(id);
  }

  getSession(id: string): SessionRuntime | undefined {
    return this.sessions.get(id);
  }

  /**
   * `/yolo` and `/auto` are usable before the view has opened a session — the
   * first message is what creates one. The request is held per view and applied
   * to the session that view opens next, so the command is never just lost.
   */
  pendingPermissionTarget(webviewId: string, fallback: PermissionMode): PermissionModeTarget {
    const pending = this.pendingPermissionByView;
    const target: PermissionModeTarget = {
      get permissionMode(): PermissionMode {
        return pending.get(webviewId) ?? fallback;
      },
      async setPermissionMode(mode: PermissionMode): Promise<void> {
        pending.set(webviewId, mode);
      },
      async togglePermissionMode(mode: Exclude<PermissionMode, "manual">): Promise<PermissionMode> {
        const next = target.permissionMode === mode ? "manual" : mode;
        await target.setPermissionMode(next);
        return next;
      },
    };
    return target;
  }

  async openSession(options: OpenSessionOptions): Promise<SessionRuntime> {
    this.ensureOpen();
    const current = this.getSessionForView(options.webviewId);
    const requestedId = options.sessionId ?? current?.id;

    if (
      current !== undefined &&
      requestedId === current.id &&
      areSameFsPath(current.session.workDir, options.workDir)
    ) {
      await applySessionPermission(current.session, current.permissionMode);
      await current.announceStatus(options.webviewId);
      return current;
    }

    let runtime = requestedId === undefined ? undefined : this.sessions.get(requestedId);
    if (runtime !== undefined) {
      assertSessionWorkDir(runtime.session, options.workDir);
      await applySessionPermission(runtime.session, runtime.permissionMode);
      await this.detachView(options.webviewId);
    } else {
      const seedMode = defaultPermissionMode(options.yoloMode);
      const session =
        requestedId === undefined
          ? await this.harness.createSession({
              workDir: options.workDir,
              model: options.model || undefined,
              thinking: normalizeEffort(options.effort),
              permission: seedMode,
              metadata: permissionModeMetadata(seedMode),
            })
          : await this.harness.resumeSession({ id: requestedId });
      try {
        assertSessionWorkDir(session, options.workDir);
        const mode = await restorePermissionMode(session, seedMode);
        await this.detachView(options.webviewId);
        runtime = this.wrapSession(session, mode);
      } catch (error) {
        await session.close().catch((closeError: unknown) => {
          this.log("Failed to close a rejected session", closeError);
        });
        throw error;
      }
    }

    await this.applyPendingPermissionMode(options.webviewId, runtime);
    runtime.subscribe(options.webviewId);
    this.sessionByView.set(options.webviewId, runtime.id);
    await runtime.announceStatus(options.webviewId);
    return runtime;
  }

  async attachResumedSession(
    webviewId: string,
    session: Session,
    yoloModeSetting = false,
  ): Promise<SessionRuntime> {
    const existing = this.sessions.get(session.id);
    if (existing !== undefined && this.sessionByView.get(webviewId) === session.id) {
      existing.subscribe(webviewId);
      await existing.announceStatus(webviewId);
      return existing;
    }
    await this.detachView(webviewId);
    let runtime = existing ?? this.sessions.get(session.id);
    if (runtime === undefined) {
      try {
        const mode = await restorePermissionMode(session, defaultPermissionMode(yoloModeSetting));
        runtime = this.wrapSession(session, mode);
      } catch (error) {
        await session.close().catch((closeError: unknown) => {
          this.log("Failed to close a rejected session", closeError);
        });
        throw error;
      }
    }
    await this.applyPendingPermissionMode(webviewId, runtime);
    runtime.subscribe(webviewId);
    this.sessionByView.set(webviewId, runtime.id);
    await runtime.announceStatus(webviewId);
    return runtime;
  }

  async detachView(webviewId: string): Promise<void> {
    const id = this.sessionByView.get(webviewId);
    if (id === undefined) return;
    this.sessionByView.delete(webviewId);
    const runtime = this.sessions.get(id);
    if (runtime === undefined) return;
    runtime.unsubscribeView(webviewId);
    if (runtime.subscribers.length === 0) {
      this.sessions.delete(id);
      await runtime.close();
    }
  }

  async closeSession(id: string): Promise<void> {
    const runtime = this.sessions.get(id);
    if (runtime === undefined) {
      await this.harness.closeSession(id);
      return;
    }
    this.sessions.delete(id);
    for (const webviewId of runtime.subscribers) {
      this.sessionByView.delete(webviewId);
    }
    await runtime.close();
  }

  async deleteSession(id: string): Promise<void> {
    await this.closeSession(id);
    await ((this.harness as any).deleteSession?.(id) ?? Promise.resolve());
  }

  /**
   * Applies an explicit settings change to the live sessions. Attach and resume
   * never do this — they restore whatever mode the session was left in.
   */
  async setPermissionModeForActiveSessions(mode: PermissionMode): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].map((session) => session.setPermissionMode(mode)),
    );
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
    this.sessionByView.clear();
    await this.harness.close();
  }

  /** Hands a `/yolo` or `/auto` issued before this view had a session to the session it just got. */
  private async applyPendingPermissionMode(
    webviewId: string,
    runtime: SessionRuntime,
  ): Promise<void> {
    const pending = this.pendingPermissionByView.get(webviewId);
    if (pending === undefined) return;
    this.pendingPermissionByView.delete(webviewId);
    await runtime.setPermissionMode(pending);
  }

  private wrapSession(session: Session, permissionMode: PermissionMode): SessionRuntime {
    const runtime = new SessionRuntime({
      session,
      permissionMode,
      broadcast: this.broadcast,
      captureBaseline: this.captureBaseline,
      log: this.log,
    });
    this.sessions.set(session.id, runtime);
    return runtime;
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("Pythinker runtime is closed.");
  }
}

/**
 * The engine forgets the permission mode when a session is resumed, so the
 * stored mode is authoritative and the seed only covers sessions that have
 * never recorded one.
 */
async function restorePermissionMode(
  session: Session,
  seedMode: PermissionMode,
): Promise<PermissionMode> {
  const storedMode = readPermissionMode(session.summary?.metadata);
  const mode = storedMode ?? seedMode;
  if (storedMode === undefined) {
    await persistPermissionMode(session, mode);
  }
  await applySessionPermission(session, mode);
  return mode;
}

async function applySessionPermission(session: Session, mode: PermissionMode): Promise<void> {
  const status = await session.getStatus();
  if (status.permission !== mode) await session.setPermission(mode);
}

export function normalizeEffort(effort: string): string {
  return effort.trim() || "off";
}

function assertSessionWorkDir(session: Pick<Session, "workDir">, expectedWorkDir: string): void {
  if (!areSameFsPath(session.workDir, expectedWorkDir)) {
    throw new Error("The selected session belongs to a different working directory.");
  }
}
