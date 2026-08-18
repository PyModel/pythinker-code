import type { PluginCommandDef } from '@pymodel/pythinker-code-sdk';

import type { PythinkerSlashCommand } from './types';

export interface PluginSlashCommands {
  readonly commands: readonly PythinkerSlashCommand[];
  /** Maps a namespaced command name (`plugin:command`) to its markdown body. */
  readonly commandMap: ReadonlyMap<string, string>;
}

export function pluginCommandName(pluginId: string, name: string): string {
  return `${pluginId}:${name}`;
}

export function buildPluginSlashCommands(defs: readonly PluginCommandDef[]): PluginSlashCommands {
  const commandMap = new Map<string, string>();
  const commands = defs.map((def) => {
    const commandName = pluginCommandName(def.pluginId, def.name);
    commandMap.set(commandName, def.body);
    return {
      name: commandName,
      aliases: [],
      description: def.description,
    } satisfies PythinkerSlashCommand;
  });
  return { commands, commandMap };
}
