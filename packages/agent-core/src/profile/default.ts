import agentYaml from './default/agent.yaml?raw';
import coderYaml from './default/coder.yaml?raw';
import coordinatorYaml from './default/coordinator.yaml?raw';
import exploreYaml from './default/explore.yaml?raw';
import initMd from './default/init.md?raw';
import planYaml from './default/plan.yaml?raw';
import systemMd from './default/system.md?raw';
import verificationYaml from './default/verification.yaml?raw';
import { loadAgentProfilesFromSources } from './load';

// Keyed by the source path the profile loader expects: profile YAML files
// plus any file referenced through `systemPromptPath`.
const PROFILE_SOURCES: Record<string, string> = {
  'profile/default/agent.yaml': agentYaml,
  'profile/default/coder.yaml': coderYaml,
  'profile/default/coordinator.yaml': coordinatorYaml,
  'profile/default/explore.yaml': exploreYaml,
  'profile/default/plan.yaml': planYaml,
  'profile/default/verification.yaml': verificationYaml,
  'profile/default/system.md': systemMd,
};

export const DEFAULT_INIT_PROMPT = initMd;

export const DEFAULT_AGENT_PROFILES = loadAgentProfilesFromSources(
  [
    'agent.yaml',
    'coder.yaml',
    'coordinator.yaml',
    'explore.yaml',
    'plan.yaml',
    'verification.yaml',
  ].map((file) => `profile/default/${file}`),
  PROFILE_SOURCES,
);
