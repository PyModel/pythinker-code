/**
 * Client-owned preferences.
 *
 * Agent/runtime settings live in core's `config.toml`; this file owns
 * pythinker-code client preferences such as terminal UI and update behavior.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';

import { getDataDir } from '#/utils/paths';

export const INVALID_TUI_CONFIG_MESSAGE =
  'Invalid TUI config in ~/.pythinker-code/tui.toml; using defaults.';

export const TuiThemeSchema = z.string();

export const NotificationConditionSchema = z.enum(['unfocused', 'always']);

// "fixed" pins the editor + footer to the bottom of a full-height screen
// with an app-owned transcript viewport; "inline" is the legacy flow.
export const TuiLayoutSchema = z.enum(['fixed', 'inline']);

export const NotificationsConfigSchema = z.object({
  enabled: z.boolean(),
  condition: NotificationConditionSchema,
});

export const UpgradePreferencesSchema = z.object({
  autoInstall: z.boolean(),
});

const StatusLineFileSchema = z.object({
  show_model: z.boolean().optional(),
  show_effort: z.boolean().optional(),
  show_token_speed: z.boolean().optional(),
  show_context_bar: z.boolean().optional(),
  show_git: z.boolean().optional(),
  show_modes: z.boolean().optional(),
  show_elapsed: z.boolean().optional(),
  show_goal: z.boolean().optional(),
  show_background_tasks: z.boolean().optional(),
});

export const StatusLineConfigSchema = z.object({
  showModel: z.boolean(),
  showEffort: z.boolean(),
  showTokenSpeed: z.boolean(),
  showContextBar: z.boolean(),
  showGit: z.boolean(),
  showModes: z.boolean(),
  showElapsed: z.boolean(),
  showGoal: z.boolean(),
  showBackgroundTasks: z.boolean(),
});

export const TuiConfigFileSchema = z.object({
  theme: TuiThemeSchema.optional(),
  layout: TuiLayoutSchema.optional(),
  copy_full_response: z.boolean().optional(),
  editor: z
    .object({
      command: z.string().optional(),
    })
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      notification_condition: NotificationConditionSchema.optional(),
    })
    .optional(),
  upgrade: z
    .object({
      auto_install: z.boolean().optional(),
    })
    .optional(),
  status_line: StatusLineFileSchema.optional(),
});

export const TuiConfigSchema = z.object({
  theme: TuiThemeSchema,
  layout: TuiLayoutSchema,
  copyFullResponse: z.boolean(),
  editorCommand: z.string().nullable(),
  notifications: NotificationsConfigSchema,
  upgrade: UpgradePreferencesSchema,
  statusLine: StatusLineConfigSchema,
});

export type TuiConfigFileShape = z.infer<typeof TuiConfigFileSchema>;
export type TuiConfig = z.infer<typeof TuiConfigSchema>;
export type TuiLayout = z.infer<typeof TuiLayoutSchema>;
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
export type UpgradePreferences = z.infer<typeof UpgradePreferencesSchema>;
export type StatusLineConfig = z.infer<typeof StatusLineConfigSchema>;

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  condition: 'unfocused',
};

export const DEFAULT_UPGRADE_PREFERENCES: UpgradePreferences = {
  autoInstall: true,
};

export const DEFAULT_STATUS_LINE_CONFIG: StatusLineConfig = {
  showModel: true,
  showEffort: true,
  showTokenSpeed: true,
  showContextBar: true,
  showGit: true,
  showModes: true,
  showElapsed: true,
  showGoal: true,
  showBackgroundTasks: true,
};

export const DEFAULT_TUI_CONFIG: TuiConfig = TuiConfigSchema.parse({
  theme: 'auto',
  layout: 'fixed',
  copyFullResponse: false,
  editorCommand: null,
  notifications: DEFAULT_NOTIFICATIONS_CONFIG,
  upgrade: DEFAULT_UPGRADE_PREFERENCES,
  statusLine: DEFAULT_STATUS_LINE_CONFIG,
});

/**
 * Thrown by `loadTuiConfig` when the on-disk TOML cannot be parsed.
 * Carries `fallback` so the caller can recover without re-running the
 * I/O, and use `message` (== `INVALID_TUI_CONFIG_MESSAGE`) as a
 * user-facing notice.
 */
export class TuiConfigParseError extends Error {
  override readonly name = 'TuiConfigParseError';
  readonly fallback: TuiConfig;
  constructor(fallback: TuiConfig) {
    super(INVALID_TUI_CONFIG_MESSAGE);
    this.fallback = fallback;
  }
}

export function getTuiConfigPath(): string {
  return join(getDataDir(), 'tui.toml');
}

export async function loadTuiConfig(filePath: string = getTuiConfigPath()): Promise<TuiConfig> {
  if (!existsSync(filePath)) {
    await saveTuiConfig(DEFAULT_TUI_CONFIG, filePath);
    return DEFAULT_TUI_CONFIG;
  }

  try {
    const text = await readFile(filePath, 'utf-8');
    return parseTuiConfig(text);
  } catch {
    throw new TuiConfigParseError(DEFAULT_TUI_CONFIG);
  }
}

export function parseTuiConfig(tomlText: string): TuiConfig {
  if (tomlText.trim().length === 0) {
    return DEFAULT_TUI_CONFIG;
  }
  const raw = parseToml(tomlText) as Record<string, unknown>;
  const parsed = TuiConfigFileSchema.parse(raw);
  return normalizeTuiConfig(parsed);
}

export async function saveTuiConfig(
  config: TuiConfig,
  filePath: string = getTuiConfigPath(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderTuiConfig(config), 'utf-8');
}

export function normalizeTuiConfig(config: TuiConfigFileShape): TuiConfig {
  const command = config.editor?.command?.trim();
  return TuiConfigSchema.parse({
    theme: config.theme ?? DEFAULT_TUI_CONFIG.theme,
    layout: config.layout ?? DEFAULT_TUI_CONFIG.layout,
    copyFullResponse: config.copy_full_response ?? DEFAULT_TUI_CONFIG.copyFullResponse,
    editorCommand: command === undefined || command.length === 0 ? null : command,
    notifications: {
      enabled: config.notifications?.enabled ?? DEFAULT_NOTIFICATIONS_CONFIG.enabled,
      condition:
        config.notifications?.notification_condition ?? DEFAULT_NOTIFICATIONS_CONFIG.condition,
    },
    upgrade: {
      autoInstall: config.upgrade?.auto_install ?? DEFAULT_UPGRADE_PREFERENCES.autoInstall,
    },
    statusLine: {
      showModel: config.status_line?.show_model ?? DEFAULT_STATUS_LINE_CONFIG.showModel,
      showEffort: config.status_line?.show_effort ?? DEFAULT_STATUS_LINE_CONFIG.showEffort,
      showTokenSpeed:
        config.status_line?.show_token_speed ?? DEFAULT_STATUS_LINE_CONFIG.showTokenSpeed,
      showContextBar:
        config.status_line?.show_context_bar ?? DEFAULT_STATUS_LINE_CONFIG.showContextBar,
      showGit: config.status_line?.show_git ?? DEFAULT_STATUS_LINE_CONFIG.showGit,
      showModes: config.status_line?.show_modes ?? DEFAULT_STATUS_LINE_CONFIG.showModes,
      showElapsed: config.status_line?.show_elapsed ?? DEFAULT_STATUS_LINE_CONFIG.showElapsed,
      showGoal: config.status_line?.show_goal ?? DEFAULT_STATUS_LINE_CONFIG.showGoal,
      showBackgroundTasks:
        config.status_line?.show_background_tasks ??
        DEFAULT_STATUS_LINE_CONFIG.showBackgroundTasks,
    },
  });
}

export function renderTuiConfig(config: TuiConfig): string {
  return `# ~/.pythinker-code/tui.toml
# Client preferences for pythinker-code.
# Agent/runtime settings stay in ~/.pythinker-code/config.toml.

theme = "${escapeTomlBasicString(config.theme)}" # "auto" | "dark" | "light" | custom theme name
layout = "${config.layout}" # "fixed" | "inline"
copy_full_response = ${String(config.copyFullResponse)} # true skips the /copy code-block picker

[editor]
command = "${escapeTomlBasicString(config.editorCommand ?? '')}" # Empty uses $VISUAL / $EDITOR

[notifications]
enabled = ${String(config.notifications.enabled)} # true | false
notification_condition = "${config.notifications.condition}" # "unfocused" | "always"

[upgrade]
auto_install = ${String(config.upgrade.autoInstall)} # true | false

[status_line]
show_model = ${String(config.statusLine.showModel)} # Model name
show_effort = ${String(config.statusLine.showEffort)} # Thinking effort; requires show_model
show_token_speed = ${String(config.statusLine.showTokenSpeed)} # Live t/s; requires show_model
show_context_bar = ${String(config.statusLine.showContextBar)} # Context gauge and token totals
show_git = ${String(config.statusLine.showGit)} # Git branch, changes, and pull request
show_modes = ${String(config.statusLine.showModes)} # Workflow, permission, and plan modes
show_elapsed = ${String(config.statusLine.showElapsed)} # Active request elapsed time
show_goal = ${String(config.statusLine.showGoal)} # Goal badge
show_background_tasks = ${String(config.statusLine.showBackgroundTasks)} # Shell and agent task badges
`;
}

function escapeTomlBasicString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\b', '\\b')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\f', '\\f')
    .replaceAll('\r', '\\r');
}
