import type { ModelCapability, ProviderConfig } from '@pymodel/kosong';

export interface AgentConfigData {
  cwd: string;
  provider?: ProviderConfig;
  modelAlias?: string;
  modelCapabilities: ModelCapability;
  profileName?: string;
  thinkingLevel: string;
  fastMode?: boolean;
  fastModeSupported?: boolean;
  systemPrompt: string;
  maxStepsPerTurn?: number;
}

export type AgentConfigUpdateData = Partial<{
  cwd: string;
  modelAlias: string;
  profileName: string;
  thinkingLevel: string;
  fastMode: boolean;
  systemPrompt: string;
  maxStepsPerTurn: number;
}>;
