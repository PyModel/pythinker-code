export default {
  trigger: 'Connectors',
  triggerLabel: 'Choose which connectors this session may use',
  back: 'Back',
  loading: 'Loading…',
  tools: {
    title: 'Tools',
    caption: 'Applies to this session immediately.',
    toggle: 'Use {name}',
  },
  skills: {
    title: 'Skills',
    caption: 'Read-only here. Skills cannot be enabled or disabled from this menu.',
    toggle: 'Skill {name}',
  },
  mcp: {
    title: 'MCP servers',
    caption: 'Applies to this session immediately.',
    toggle: 'Use {name}',
  },
  plugins: {
    title: 'Plugins',
    caption: 'Global to the daemon. Changes affect every session immediately.',
    toggle: 'Enable {name}',
  },
} as const;
