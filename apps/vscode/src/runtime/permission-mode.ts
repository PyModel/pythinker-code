import type { JsonObject, PermissionMode, Session } from "@pymodel/pythinker-code-sdk";

/**
 * The engine keeps the permission mode in memory only, so a resumed session
 * would always come back as `manual`. The extension persists the mode the user
 * chose in session metadata and restores it on attach.
 */
export const SESSION_PERMISSION_MODE_KEY = "vscode_permission_mode";

const PERMISSION_MODES: ReadonlySet<PermissionMode> = new Set(["manual", "auto", "yolo"]);

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && PERMISSION_MODES.has(value as PermissionMode);
}

export function readPermissionMode(
  metadata: Readonly<Record<string, unknown>> | undefined,
): PermissionMode | undefined {
  const value = metadata?.[SESSION_PERMISSION_MODE_KEY];
  return isPermissionMode(value) ? value : undefined;
}

export function permissionModeMetadata(mode: PermissionMode): JsonObject {
  return { [SESSION_PERMISSION_MODE_KEY]: mode };
}

/**
 * The session-meta patch is a shallow merge, and the caller-owned bag it lands
 * in is `custom` — surfaced as `summary.metadata` on the read side. The whole
 * bag is rewritten so the keys it already holds survive the patch.
 */
export async function persistPermissionMode(
  session: Session,
  mode: PermissionMode,
): Promise<void> {
  const meta = await session.getSessionMetadata();
  await session.updateSessionMetadata({
    custom: { ...meta.custom, ...permissionModeMetadata(mode) },
  });
}

/**
 * What `/yolo` and `/auto` act on. A live session is the usual target, but the
 * command also arrives before the view has one, so the pending target below
 * satisfies the same shape.
 */
export interface PermissionModeTarget {
  readonly permissionMode: PermissionMode;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  togglePermissionMode(mode: Exclude<PermissionMode, "manual">): Promise<PermissionMode>;
}

/** The `pythinker.yoloMode` setting seeds new sessions; it never overrides a stored mode. */
export function defaultPermissionMode(yoloModeSetting: boolean): PermissionMode {
  return yoloModeSetting ? "yolo" : "manual";
}
