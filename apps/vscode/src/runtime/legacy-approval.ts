import type { JsonObject, PermissionMode } from "@pythoughts/pythinker-code-sdk";

export const LEGACY_APPROVAL_METADATA_KEY = "vscode_legacy_approval";

export interface LegacyApprovalFlags {
  readonly yolo: boolean;
  readonly afk: boolean;
}

export function readLegacyApprovalFlags(
  metadata: Readonly<Record<string, unknown>> | undefined,
): LegacyApprovalFlags | undefined {
  const value = metadata?.[LEGACY_APPROVAL_METADATA_KEY];
  return parseLegacyApprovalFlags(value);
}

function parseLegacyApprovalFlags(value: unknown): LegacyApprovalFlags | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const yolo = Reflect.get(value, "yolo");
  const afk = Reflect.get(value, "afk");
  if (typeof yolo !== "boolean" && typeof afk !== "boolean") return undefined;
  return {
    yolo: typeof yolo === "boolean" ? yolo : false,
    afk: typeof afk === "boolean" ? afk : false,
  };
}

export function legacyApprovalMetadata(flags: LegacyApprovalFlags): JsonObject {
  return {
    [LEGACY_APPROVAL_METADATA_KEY]: {
      yolo: flags.yolo,
      afk: flags.afk,
    },
  };
}

export function corePermissionForLegacyApproval(flags: LegacyApprovalFlags): PermissionMode {
  if (flags.afk) return "auto";
  return flags.yolo ? "yolo" : "manual";
}

/**
 * The global `pythinker.yoloMode` setting is authoritative whenever a session
 * attaches to the runtime; afk stays per-session because it has no global
 * setting counterpart.
 */
export function withGlobalYoloMode(
  flags: LegacyApprovalFlags,
  yoloMode: boolean,
): LegacyApprovalFlags {
  return flags.yolo === yoloMode ? flags : { yolo: yoloMode, afk: flags.afk };
}
