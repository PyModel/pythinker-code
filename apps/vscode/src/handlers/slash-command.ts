import type { Stats } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import * as vscode from "vscode";

import {
  buildSkillSlashCommands,
  type PermissionMode,
  type SkillSummary,
} from "@pymodel/pythinker-code-sdk";

import type { PermissionModeTarget } from "../runtime/permission-mode";
import type { SessionRuntime } from "../runtime/session-runtime";
import {
  buildExportMarkdown,
  isImportableTextFile,
  isSensitiveFile,
  stringifyContextHistory,
} from "../utils/session-context";
import type { HandlerContext } from "./types";

const HOST_COMMANDS = new Set([
  "init",
  "compact",
  "clear",
  "reset",
  "yolo",
  "auto",
  "afk",
  "plan",
  "add-dir",
  "export",
  "import",
]);
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export interface HostSlashCommand {
  readonly name: string;
  readonly args: string;
  readonly raw: string;
  /** Set when the command names a skill; built-in skills are not `skill:`-prefixed. */
  readonly skillName?: string;
}

/**
 * `listSkills` is consulted only for a `/word` that is not a host command, so an
 * ordinary message never pays for it. Anything that resolves to neither a host
 * command nor a skill is left alone and goes to the model as text.
 */
export async function parseHostSlashCommand(
  content: string | readonly unknown[],
  listSkills?: () => Promise<readonly SkillSummary[]>,
): Promise<HostSlashCommand | undefined> {
  if (typeof content !== "string") return undefined;
  const raw = content.trim();
  const match = /^\/([^\s]+)(?:\s+(.*))?\s*$/s.exec(raw);
  if (match === null) return undefined;
  const name = match[1]!.toLowerCase();
  const args = match[2]?.trim() ?? "";
  if (HOST_COMMANDS.has(name)) return { name, args, raw };

  const skills = listSkills === undefined ? undefined : await listSkills().catch(() => undefined);
  if (skills === undefined) {
    // The parser runs on every message that starts with "/", so a catalog
    // failure must degrade to the prefix check rather than reject and take the
    // whole send down with it.
    return name.startsWith("skill:") ? { name, args, raw, skillName: name.slice(6) } : undefined;
  }
  const { commandMap } = buildSkillSlashCommands(skills);
  const skillName = commandMap.get(name) ?? commandMap.get(match[1]!);
  if (skillName !== undefined) return { name, args, raw, skillName };
  // A skill the catalog no longer lists still reaches the engine, which reports
  // the miss far better than silently sending "/skill:foo" to the model.
  return name.startsWith("skill:") ? { name, args, raw, skillName: name.slice(6) } : undefined;
}

export async function runHostSlashCommand(
  runtime: SessionRuntime,
  command: HostSlashCommand,
  ctx: HandlerContext,
): Promise<boolean> {
  if (command.skillName !== undefined) {
    const skillName = command.skillName;
    const result = await runtime.runTurnAction(command.raw, async () => {
      await runtime.session.activateSkill(skillName, command.args || undefined);
    });
    return result.status === "finished";
  }

  const actionId = runtime.beginHostAction(command.raw, command.name === "import");
  const emit = (text: string): void => runtime.emitHostText(text, actionId);
  try {
    if (command.name === "import") {
      const result = await importContext(runtime, command.args, ctx);
      emit(result.message);
      if (result.sensitive) {
        void vscode.window.showWarningMessage(
          "Pythinker: The imported file may contain API keys, tokens, or credentials.",
        );
      }
    } else {
      switch (command.name) {
        case "init":
          await runtime.session.init();
          emit("AGENTS.md has been generated.");
          break;
        case "compact":
          await runtime.compactHostAction(actionId, command.args || undefined);
          emit("The context has been compacted.");
          break;
        case "clear":
        case "reset":
          await (runtime.session as any).clearContext?.();
          emit("The context has been cleared.");
          break;
        case "yolo":
          await runPermissionCommand(runtime, "yolo", command.args, emit);
          break;
        case "auto":
        case "afk":
          await runPermissionCommand(runtime, "auto", command.args, emit);
          break;
        case "plan":
          await runPlanCommand(runtime, command.args, emit);
          break;
        case "add-dir":
          await runAddDirCommand(runtime, command.args, emit);
          break;
        case "export":
          await exportContext(runtime, command.args, emit);
          break;
      }
    }

    if (runtime.wasHostActionCancelled(actionId)) return false;
    runtime.completeHostAction("finished", actionId);
    return true;
  } catch (error) {
    if (runtime.wasHostActionCancelled(actionId)) return false;
    runtime.failHostAction(actionId);
    throw error;
  } finally {
    runtime.releaseHostAction(actionId);
  }
}

const PERMISSION_MODE_ENABLED_MESSAGE = {
  yolo: "You only live once! Tool actions will be auto-approved; the agent may still ask questions.",
  auto: "Auto mode enabled. Questions will be auto-dismissed and tool calls auto-approved.",
} as const;

const PERMISSION_MODE_DISABLED_MESSAGE = {
  yolo: "You only die once! Actions will require approval.",
  auto: "Auto mode disabled. You are back at the keyboard.",
} as const;

/** `on`, `off`, or a bare toggle — the argument forms `/yolo` and `/auto` accept. */
export type PermissionCommandRequest = "on" | "off" | "toggle";

export function parsePermissionCommandRequest(args: string): PermissionCommandRequest {
  const subcommand = args.trim().toLowerCase();
  if (subcommand === "on") return "on";
  if (subcommand === "off") return "off";
  return "toggle";
}

/**
 * Applies a `/yolo` or `/auto` request and reports the resulting mode. Callers
 * own how the message is surfaced, so this runs identically whether the command
 * came in between turns, mid-turn over the bridge, or before the view has a
 * session at all.
 */
export async function applyPermissionCommand(
  runtime: PermissionModeTarget,
  mode: "yolo" | "auto",
  request: PermissionCommandRequest,
): Promise<{ mode: PermissionMode; message: string }> {
  const requested = request === "on" ? mode : request === "off" ? "manual" : undefined;

  if (requested !== undefined && runtime.permissionMode === requested) {
    return {
      mode: requested,
      message:
        requested === mode ? `${label(mode)} is already on.` : `${label(mode)} is already off.`,
    };
  }

  let current: PermissionMode;
  if (requested === undefined) {
    current = await runtime.togglePermissionMode(mode);
  } else {
    await runtime.setPermissionMode(requested);
    current = requested;
  }

  return {
    mode: current,
    message:
      current === mode
        ? PERMISSION_MODE_ENABLED_MESSAGE[mode]
        : PERMISSION_MODE_DISABLED_MESSAGE[mode],
  };
}

/** `/yolo` and `/auto` accept `on` and `off`, and toggle without an argument — as the CLI does. */
async function runPermissionCommand(
  runtime: SessionRuntime,
  mode: "yolo" | "auto",
  args: string,
  emit: (text: string) => void,
): Promise<void> {
  const result = await applyPermissionCommand(
    runtime,
    mode,
    parsePermissionCommandRequest(args),
  );
  emit(result.message);
}

function label(mode: "yolo" | "auto"): string {
  return mode === "yolo" ? "YOLO mode" : "Auto mode";
}

async function runPlanCommand(
  runtime: SessionRuntime,
  args: string,
  emit: (text: string) => void,
): Promise<void> {
  const subcommand = args.trim().toLowerCase();
  if (subcommand === "view") {
    const plan = await runtime.session.getPlan();
    emit(plan?.content.trim() || "No plan file found for this session.");
    return;
  }
  if (subcommand === "clear") {
    await runtime.session.clearPlan();
    emit("Plan cleared.");
    return;
  }
  const status = await runtime.session.getStatus();
  const enabled = subcommand === "on" ? true : subcommand === "off" ? false : !status.planMode;
  if (subcommand && subcommand !== "on" && subcommand !== "off") {
    throw new Error(`Unknown plan subcommand: ${subcommand}`);
  }
  if (status.planMode !== enabled) await runtime.session.setPlanMode(enabled);
  if (!enabled) {
    emit("Plan mode OFF. All tools are now available.");
    return;
  }
  const plan = await runtime.session.getPlan().catch(() => null);
  emit(plan?.path
    ? `Plan mode ON. Plan file: ${plan.path}`
    : "Plan mode ON.");
}

async function runAddDirCommand(
  runtime: SessionRuntime,
  args: string,
  emit: (text: string) => void,
): Promise<void> {
  const input = stripMatchingQuotes(args.trim());
  if (!input || input.toLowerCase() === "list") {
    const dirs = ((runtime.session.summary as any)?.additionalDirs as string[] | undefined) ?? [];
    emit(dirs.length === 0
      ? "No additional directories. Usage: /add-dir <path>"
      : ["Additional directories:", ...dirs.map((p: string) => `  - ${p}`)].join("\n"));
    return;
  }
  const result = await (runtime.session as any).addAdditionalDir?.(input, { persist: false }) ?? { additionalDirs: [input] };
  emit(`Added directory to workspace: ${result.additionalDirs.at(-1) ?? input}`);
}

async function exportContext(
  runtime: SessionRuntime,
  args: string,
  emit: (text: string) => void,
): Promise<void> {
  const context = await runtime.session.getContext();
  const now = new Date();
  const defaultName = defaultExportName(runtime.id, now);
  const outputPath = await resolveExportPath(args, runtime.session.workDir, defaultName);
  const markdown = buildExportMarkdown({
    sessionId: runtime.id,
    workDir: runtime.session.workDir,
    history: context.history,
    tokenCount: context.tokenCount,
    now,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
  emit(
    `Exported ${String(context.history.length)} messages to ${outputPath}\n\n` +
    "Note: The exported file may contain sensitive information. Please be cautious when sharing it externally.",
  );
  void vscode.window.showInformationMessage("Pythinker: Session exported.", "Open File").then((action) => {
    if (action !== "Open File") return;
    void vscode.window.showTextDocument(vscode.Uri.file(outputPath));
  });
}

async function importContext(
  runtime: SessionRuntime,
  args: string,
  ctx: HandlerContext,
): Promise<{ message: string; sensitive: boolean }> {
  const target = stripMatchingQuotes(args.trim());
  if (!target) throw new Error("Usage: /import <file_path or session_id>");

  const candidate = resolveUserPath(target, runtime.session.workDir);
  const file = await fileInfo(candidate);
  if (file?.isDirectory()) throw new Error("The specified path is a directory; please provide a file to import.");
  if (file?.isFile()) {
    if (!isImportableTextFile(candidate)) {
      throw new Error(`Unsupported file type '${candidate.slice(candidate.lastIndexOf("."))}'. /import only supports text-based files.`);
    }
    if (file.size > MAX_IMPORT_BYTES) {
      throw new Error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum import size is 10 MB.`);
    }
    const bytes = await readFile(candidate);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Cannot import '${basename(candidate)}': the file is not valid UTF-8 text.`);
    }
    if (!content.trim()) throw new Error("The file is empty, nothing to import.");
    const source = `file '${basename(candidate)}'`;
    if (typeof (runtime.session as any).importContext === "function") {
      await (runtime.session as any).importContext(content, source);
    } else {
      await runtime.session.prompt(`[Imported context from ${source}]\n\n${content}`);
    }
    return {
      message: `Imported context from ${source} (${String(content.length)} chars).`,
      sensitive: isSensitiveFile(basename(candidate)),
    };
  }

  if (target === runtime.id) throw new Error("Cannot import the current session into itself.");
  const summary = (await ctx.harness.listSessions({
    workDir: runtime.session.workDir,
    sessionId: target,
  })).find((session) => session.id === target);
  if (summary === undefined) throw new Error(`'${target}' is not a valid file path or session ID.`);

  const activeSource = ctx.runtime.getSession(target)?.session;
  const sourceSession = activeSource ?? await ctx.harness.resumeSession({ id: target });
  try {
    const sourceContext = await sourceSession.getContext();
    if (sourceContext.history.length === 0) throw new Error("The source session has no messages.");
    const content = stringifyContextHistory(sourceContext.history);
    if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) {
      throw new Error("Session content is too large. Maximum import size is 10 MB.");
    }
    const source = `session '${target}'`;
    await (runtime.session as any).importContext?.(content, source);
    return {
      message: `Imported context from ${source} (${String(content.length)} chars).`,
      sensitive: false,
    };
  } finally {
    if (activeSource === undefined) await sourceSession.close();
  }
}

async function resolveExportPath(args: string, workDir: string, defaultName: string): Promise<string> {
  const raw = stripMatchingQuotes(args.trim());
  if (!raw) return join(workDir, defaultName);
  const resolved = resolveUserPath(raw, workDir);
  const info = await fileInfo(resolved);
  return raw.endsWith("/") || raw.endsWith("\\") || info?.isDirectory()
    ? join(resolved, defaultName)
    : resolved;
}

function defaultExportName(sessionId: string, now: Date): string {
  const timestamp = now.toISOString().replaceAll(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `pythinker-export-${sessionId.slice(0, 8)}-${timestamp}.md`;
}

function resolveUserPath(value: string, workDir: string): string {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  return isAbsolute(expanded) ? expanded : resolve(workDir, expanded);
}

async function fileInfo(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value.at(-1);
  return (first === last && (first === '"' || first === "'")) ? value.slice(1, -1) : value;
}
