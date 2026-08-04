import { INSTALL_CHANNELS } from './install-channels';

const installCommandTool = {
  name: 'get-install-command',
  description: 'Get the official Pythinker Code installation command for a supported platform or package manager.',
  inputSchema: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Installation channel.',
        enum: INSTALL_CHANNELS.map(({ id }) => id),
      },
    },
    required: ['channel'],
    additionalProperties: false,
  },
  execute({ channel }) {
    const selected = INSTALL_CHANNELS.find(({ id }) => id === channel);
    if (!selected) throw new Error(`Unsupported installation channel: ${channel}`);

    return {
      content: [{ type: 'text', text: `${selected.label}: ${selected.command}` }],
    };
  },
};

export function registerWebMcpTools(modelContext = navigator.modelContext) {
  if (!modelContext) return false;

  if (typeof modelContext.provideContext === 'function') {
    modelContext.provideContext({ tools: [installCommandTool] });
    return true;
  }

  if (typeof modelContext.registerTool === 'function') {
    modelContext.registerTool(installCommandTool);
    return true;
  }

  return false;
}
