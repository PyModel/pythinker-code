import type { ModelCapability, ProviderConfig } from '@pymodel/kosong';

export interface AgentConfigData {
  cwd: string;
  provider?: ProviderConfig;
  modelAlias?: string;
  modelCapabilities: ModelCapability;
  profileName?: string;
  subagentNames?: readonly string[];
  thinkingEffort: string;
  systemPrompt: string;
}

export type AgentConfigUpdateData = Partial<{
  cwd: string;
  modelAlias: string;
  profileName: string;
  subagentNames: readonly string[];
  thinkingEffort: string;
  systemPrompt: string;
}>;
