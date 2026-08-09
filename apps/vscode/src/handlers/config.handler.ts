import { readFile } from "node:fs/promises";
import * as vscode from "vscode";
import { buildSkillSlashCommands, type SkillSlashCommand } from "@pythoughts/pythinker-code-sdk";
type SdkConfig = any;

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
  const effort = normalizeEffort(params.effort ?? (params.thinking === true ? "on" : "off"));
  const full = { mode: params.thinking === false ? "off" : "on", effort };

  const config = await ctx.harness.getConfig({ reload: true });
  const currentEffort = (config.thinking as any)?.effort;
  const effortChanged = params.effort !== undefined && currentEffort !== effort;
  // If the user modified only the model dropdown, update only defaultModel +
  // thinking.enabled to match the release behavior (tested by the
  // persistModelSelection rule).
  const patch = effortChanged ? full : { mode: full.mode };
  if (
    config.defaultModel !== params.model
    || (config.thinking as any)?.mode !== patch.mode
    || (effortChanged && (config.thinking as any)?.effort !== (patch as any).effort)
  ) {
    await ctx.harness.setConfig({
      defaultModel: params.model,
      thinking: patch as any,
    });
  }

  const runtime = ctx.getSession();
  if (runtime !== undefined) {
    const status = await runtime.session.getStatus();
    if (status.model !== params.model) await runtime.session.setModel(params.model);
    if (status.thinkingLevel !== effort) await runtime.session.setThinking(effort);
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

export function toWebviewConfig(config: SdkConfig): ModelsConfig {
  const models: ModelConfig[] = Object.entries(config.models ?? {})
    .map(([id, model]) => toWebviewModel(id, model as any))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  return {
    defaultModel: config.defaultModel ?? models[0]?.id ?? null,
    defaultThinking: config.thinking?.enabled !== false,
    defaultThinkingEffort: config.thinking?.effort,
    models,
  };
}

function toWebviewModel(id: string, model: any): ModelConfig {
  return {
    id,
    name: model.displayName ?? model.model ?? id,
    provider: model.provider ?? "unknown",
    capabilities: [...(model.capabilities ?? [])],
    contextWindow: typeof model.maxContextSize === "number" ? model.maxContextSize : undefined,
    adaptive_thinking: model.adaptiveThinking,
    support_efforts:
      model.supportEfforts === undefined ? undefined : [...model.supportEfforts],
    default_effort: model.defaultEffort,
  };
}

