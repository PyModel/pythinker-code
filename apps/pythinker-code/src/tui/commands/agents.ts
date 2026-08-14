import type {
  AgentProfileSummary,
} from '@pymodel/pythinker-code-sdk';

import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

export async function handleAgentsCommand(
  host: SlashCommandHost,
  args: string,
): Promise<void> {
  if (args.trim().length > 0) {
    host.showError('Usage: /agents');
    return;
  }

  let catalog;
  try {
    catalog = await host.harness.listAgentProfiles(host.state.appState.workDir);
  } catch (error) {
    host.showError(`Failed to load agent profiles: ${formatErrorMessage(error)}`);
    return;
  }
  for (const warning of catalog.warnings) {
    host.showStatus(`${warning.path}: ${warning.error}`, 'warning');
  }
  if (catalog.profiles.length === 0) {
    host.showNotice(
      'No agent profiles found',
      'Create profiles in .pythinker-code/agents or ~/.pythinker-code/agents.',
    );
    return;
  }

  host.mountEditorReplacement(
    new ChoicePickerComponent({
      title: 'Agent profiles',
      options: catalog.profiles.map((profile) => ({
        value: profile.name,
        label: profile.name,
        description: [
          profile.source,
          profile.background === true ? 'background' : 'foreground',
          profile.description,
        ].filter((part) => part !== undefined && part.length > 0).join(' · '),
      })),
      searchable: true,
      onSelect: (name) => {
        host.restoreEditor();
        const profile = catalog.profiles.find((candidate) => candidate.name === name);
        if (profile !== undefined) showAgentProfile(host, profile);
      },
      onCancel: () => {
        host.restoreEditor();
      },
    }),
  );
}

function showAgentProfile(host: SlashCommandHost, profile: AgentProfileSummary): void {
  const settings = [
    `source: ${profile.source}`,
    `tools: ${profile.tools.length === 0 ? 'all inherited tools' : profile.tools.join(', ')}`,
    profile.model === undefined ? undefined : `model: ${profile.model}`,
    profile.effort === undefined ? undefined : `effort: ${profile.effort}`,
    profile.permissionMode === undefined
      ? undefined
      : `permission: ${profile.permissionMode}`,
    profile.background === undefined
      ? undefined
      : `execution: ${profile.background ? 'background' : 'foreground'}`,
    profile.maxTurns === undefined ? undefined : `max turns: ${String(profile.maxTurns)}`,
    profile.isolation === undefined ? undefined : `isolation: ${profile.isolation}`,
    profile.memory === undefined ? undefined : `memory: ${profile.memory}`,
    profile.subagents.length === 0
      ? undefined
      : `subagents: ${profile.subagents.join(', ')}`,
    profile.whenToUse === undefined ? undefined : `when to use: ${profile.whenToUse}`,
  ].filter((line): line is string => line !== undefined);
  host.showNotice(profile.name, [profile.description, ...settings].filter(Boolean).join('\n'));
}
