import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import {
  buildSkillSlashCommands,
  effectiveModelAlias,
  type ModelAlias,
  type PythinkerConfig as SdkPythinkerConfig,
  type SkillSlashCommand,
  type ThinkingEffort,
} from "@pymodel/pythinker-code-sdk";

import { Methods } from "../../shared/bridge";
import type {
  ModelConfig,
  ModelsConfig,
  SlashCommandInfo,
} from "../../shared/legacy-sdk";
import type { ConfigInfo, ExtensionConfig, SessionConfig } from "../../shared/types";
import { VSCodeSettings } from "../config/vscode-settings";
import { normalizeEffort } from "../runtime/pythinker-runtime";
import type { Handler } from "./types";

const SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "init", aliases: [], description: "Analyze the codebase and generate AGENTS.md" },
  { name: "compact", aliases: [], description: "Compact the conversation context" },
  { name: "clear", aliases: ["reset"], description: "Clear the context" },
  {
    name: "yolo",
    aliases: [],
    description: "Toggle YOLO mode (auto-approve tool actions; may still ask questions). Usage: /yolo [on|off]",
  },
  {
    name: "auto",
    aliases: ["afk"],
    description: "Toggle Auto mode (fully autonomous; the agent will not ask questions). Usage: /auto [on|off]",
  },
  { name: "plan", aliases: [], description: "Toggle plan mode. Usage: /plan [on|off|view|clear]" },
  {
    name: "add-dir",
    aliases: [],
    description: "Add a directory to the workspace. Usage: /add-dir <path>",
  },
  { name: "export", aliases: [], description: "Export current session context to a markdown file" },
  { name: "import", aliases: [], description: "Import context from a file or session ID" },
];

const saveConfig: Handler<SessionConfig, { ok: boolean }> = async (params, ctx) => {
  const effort = normalizeEffort(params.effort ?? (params.thinking === true ? "on" : "off")) as ThinkingEffort;
  const effortChanged = params.effortChanged !== false;
  const config = await ctx.harness.getConfig({ reload: true });
  const model = config.models?.[params.model];
  const full = thinkingConfig(
    effort,
    model === undefined ? undefined : effectiveModelAlias(model).supportEfforts,
  );
  // Re-confirming the effort already shown is not an explicit choice —
  // persist the model but leave the stored effort preference alone (the TUI's
  // persistModelSelection rule).
  const patch = effortChanged ? full : { enabled: full.enabled };
  if (
    config.defaultModel !== params.model
    || config.thinking?.enabled !== patch.enabled
    || (effortChanged && config.thinking?.effort !== patch.effort)
  ) {
    await ctx.harness.setConfig({ defaultModel: params.model, thinking: patch });
  }

  const runtime = ctx.getSession();
  if (runtime !== undefined) {
    const status = await runtime.session.getStatus();
    if (status.model !== params.model) await runtime.session.setModel(params.model);
    if (status.thinkingEffort !== effort) await runtime.session.setThinking(effort);
  }
  return { ok: true };
};

/**
 * The raw config file, verbatim — deliberately NOT the parsed+redacted webview
 * config. It is the user's own local file rendered in their own editor, so any
 * API keys in it are shown as-is; nothing is redacted silently.
 */
const getConfigInfo: Handler<void, ConfigInfo> = async (_, ctx) => {
  const path = ctx.harness.configPath;
  try {
    return { path, exists: true, content: await readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, exists: false, content: null };
    }
    throw error;
  }
};

const getExtensionConfig: Handler<void, ExtensionConfig> = async () => {
  return VSCodeSettings.getExtensionConfig();
};

const saveExtensionConfig: Handler<Partial<ExtensionConfig>, { ok: boolean }> = async (params) => {
  // extension.ts's onSettingsChange listener broadcasts ExtensionConfigChanged
  // to every webview once this update lands, so no explicit broadcast here.
  await VSCodeSettings.updateExtensionConfig(params);
  return { ok: true };
};

const openSettings: Handler<void, { ok: boolean }> = async () => {
  await vscode.commands.executeCommand("workbench.action.openSettings", "pythinker");
  return { ok: true };
};

const getModels: Handler<void, ModelsConfig> = async (_, ctx) => {
  return toWebviewConfig(await ctx.harness.getConfig({ reload: true }));
};

/**
 * Skills are resolved from the workspace, not from a session, so a panel that
 * has not sent a message yet still lists them. A live session is preferred when
 * there is one: only it can report the prompts of its MCP connections.
 */
export const getSlashCommands: Handler<void, SlashCommandInfo[]> = async (_, ctx) => {
  const session = ctx.getSession()?.session;
  try {
    const skills =
      session !== undefined
        ? await session.listSkills()
        : ctx.workDir !== null
          ? await ctx.harness.listWorkspaceSkills(ctx.workDir)
          : [];
    const { commands } = buildSkillSlashCommands(skills);
    return [...SLASH_COMMANDS, ...commands.map(toSlashCommandInfo)];
  } catch (error) {
    ctx.logError("Unable to list skills", error);
    return SLASH_COMMANDS;
  }
};

function toSlashCommandInfo(command: SkillSlashCommand): SlashCommandInfo {
  return {
    name: command.name,
    aliases: [...command.aliases],
    description: command.description,
  };
}

const showLogs: Handler<void, { ok: boolean }> = async (_, ctx) => {
  ctx.showLogs();
  return { ok: true };
};

const reloadWebview: Handler<void, { ok: boolean }> = async (_, ctx) => {
  await ctx.closeSession();
  ctx.fileManager.clearTracked(ctx.webviewId);
  ctx.reloadWebview();
  return { ok: true };
};

export const configHandlers = {
  [Methods.SaveConfig]: saveConfig,
  [Methods.GetConfigInfo]: getConfigInfo,
  [Methods.GetExtensionConfig]: getExtensionConfig,
  [Methods.SaveExtensionConfig]: saveExtensionConfig,
  [Methods.OpenSettings]: openSettings,
  [Methods.GetModels]: getModels,
  [Methods.GetSlashCommands]: getSlashCommands,
  [Methods.ShowLogs]: showLogs,
  [Methods.ReloadWebview]: reloadWebview,
} as Record<string, Handler<any, any>>;

export function toWebviewConfig(config: SdkPythinkerConfig): ModelsConfig {
  const models: ModelConfig[] = Object.entries(config.models ?? {})
    .map(([id, model]) => toWebviewModel(id, model))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return {
    defaultModel: config.defaultModel ?? models[0]?.id ?? null,
    defaultThinking: config.thinking?.enabled !== false,
    defaultThinkingEffort: config.thinking?.effort,
    models,
  };
}

function toWebviewModel(id: string, model: ModelAlias): ModelConfig {
  const effective = effectiveModelAlias(model);
  return {
    id,
    name: effective.displayName ?? effective.model ?? id,
    provider: effective.provider,
    capabilities: [...(effective.capabilities ?? [])],
    contextWindow: typeof effective.maxContextSize === "number" ? effective.maxContextSize : undefined,
    adaptive_thinking: effective.adaptiveThinking,
    support_efforts:
      effective.supportEfforts === undefined ? undefined : [...effective.supportEfforts],
    default_effort: effective.defaultEffort,
  };
}

/**
 * Project a thinking effort to the `[thinking]` config patch persisted to
 * config.toml — mirrors the TUI's thinkingEffortToConfig. "off" disables
 * thinking; "on" is the boolean-model on-signal, so it only persists
 * `enabled`. A concrete effort persists as the global default, EXCEPT the
 * model's highest declared level — the last entry of `support_efforts` —
 * which is session-only and records just `enabled`, so the most expensive
 * tier never becomes the global default for every new session. When the
 * model's levels are unknown the concrete effort is persisted as-is.
 */
function thinkingConfig(
  effort: ThinkingEffort,
  supportEfforts?: readonly string[],
): { enabled: boolean; effort?: string } {
  if (effort === "off") return { enabled: false };
  if (effort === "on") return { enabled: true };
  const top = supportEfforts?.at(-1);
  if (top !== undefined && effort === top) return { enabled: true };
  return { enabled: true, effort };
}
