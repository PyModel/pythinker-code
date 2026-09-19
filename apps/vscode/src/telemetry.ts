import * as vscode from "vscode";

import {
  createPythinkerDeviceId,
  PYTHINKER_REGION_PROFILES,
  resolvePythinkerRegion,
} from "@pymodel/pythinker-code-oauth";
import {
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolvePythinkerHome,
  type PythinkerConfig,
} from "@pymodel/pythinker-code-sdk";
import {
  initializeTelemetry,
  setTelemetryEnabled,
  shouldEnableTelemetry,
  shutdownTelemetry,
  track,
} from "@pymodel/pythinker-telemetry";

const SHUTDOWN_TIMEOUT_MS = 2000;

export interface ExtensionTelemetryOptions {
  readonly version: string;
  readonly log: (message: string) => void;
}

export function activateExtensionTelemetry(options: ExtensionTelemetryOptions): vscode.Disposable {
  const homeDir = resolvePythinkerHome();
  let firstLaunch = false;
  const deviceId = createPythinkerDeviceId(homeDir, {
    onFirstLaunch: () => {
      firstLaunch = true;
    },
  });
  const configPath = resolveConfigPath({ homeDir });
  const config = readTelemetryConfig(configPath);

  initializeTelemetry({
    homeDir,
    deviceId,
    enabled: config.telemetry !== false,
    initiallyEnabled: vscode.env.isTelemetryEnabled,
    appName: "pythinker-code-vscode",
    version: options.version,
    uiMode: "vscode",
    model: config.defaultModel,
    endpoint: () => telemetryEndpoint(homeDir),
    onUnexpectedError: (error) => options.log(`Telemetry dropped a property: ${error.message}`),
  });

  const staticallyEnabled = shouldEnableTelemetry({ enabled: config.telemetry !== false });
  if (firstLaunch) track("first_launch");

  return vscode.env.onDidChangeTelemetryEnabled((enabled) => {
    if (staticallyEnabled) setTelemetryEnabled(enabled);
  });
}

export async function deactivateExtensionTelemetry(): Promise<void> {
  await shutdownTelemetry({ timeoutMs: SHUTDOWN_TIMEOUT_MS });
}

function readTelemetryConfig(
  configPath: string,
): Pick<PythinkerConfig, "telemetry" | "defaultModel"> {
  try {
    const { config, fileError } = loadRuntimeConfigSafe(configPath);
    if (fileError !== undefined) return {};
    return config;
  } catch {
    return {};
  }
}

function telemetryEndpoint(homeDir: string): string {
  const region = resolvePythinkerRegion({
    homeDir,
    readMarker: process.env["PYTHINKER_CODE_REGION_MARKER"] !== "off",
  });
  return PYTHINKER_REGION_PROFILES[region].telemetryEndpoint;
}
