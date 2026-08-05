import * as vscode from "vscode";
type SdkConfig = any;

import { Methods } from "../../shared/bridge";
import type {
  ModelConfig,
  ModelsConfig,
  SlashCommandInfo,
} from "../../shared/legacy-sdk";
import type { ExtensionConfig, SessionConfig } from "../../shared/types";
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

const getSlashCommands: Handler<void, SlashCommandInfo[]> = async (_, ctx) => {
  if (!ctx.workDir) return SLASH_COMMANDS;
  try {
    const skills = await (ctx.harness as any).listWorkspaceSkills?.(ctx.workDir) ?? [];
    const skillCommands = (skills as Array<{ name: string; type: string; description?: string }>)
      .filter((skill) => isUserActivatableSkill(skill.type))
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map((skill) => ({
        name: `skill:${skill.name}`,
        aliases: [],
        description: skill.description ?? "",
      }));
    return [...SLASH_COMMANDS, ...skillCommands];
  } catch (error) {
    ctx.logError("Unable to list workspace skills", error);
    return SLASH_COMMANDS;
  }
};

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
    adaptive_thinking: model.adaptiveThinking,
    support_efforts:
      model.supportEfforts === undefined ? undefined : [...model.supportEfforts],
    default_effort: model.defaultEffort,
  };
}

function isUserActivatableSkill(type: string | undefined): boolean {
  return type === undefined || type === "prompt" || type === "inline" || type === "flow";
}
