export default {
  steps: {
    connect: 'Connect',
    model: 'Model',
    appearance: 'Appearance',
  },
  connect: {
    title: 'Connect a model',
    subtitle: 'Pythinker Code needs one model provider to run. You can add more later in Settings.',
    codexName: 'Sign in with Codex',
    codexDesc: 'Opens your browser · no API key needed',
    codexBadge: 'Fastest',
    catalogName: 'Choose a provider',
    catalogDesc: 'Paste an API key — pick from the provider catalog',
    manualName: 'Custom endpoint',
    manualDesc: 'Any OpenAI- or Anthropic-compatible base URL',
    back: 'Back to options',
  },
  model: {
    title: 'Choose your default model',
    subtitle:
      'New conversations start with this model. Any session can switch to another one at any time.',
    connected: '{provider} connected — {count} models available.',
    recommended: 'Recommended',
    showAll: 'Show all {count} models',
    showFewer: 'Show fewer',
    none: 'This provider offers no model that can run a conversation. Connect a different one.',
  },
  appearance: {
    title: 'Make it yours',
    subtitle: "You're set up. Pick a look — you can change it any time in Settings.",
    ready: '{model} is your default model. Ready to go.',
    finish: 'Start using Pythinker Code',
  },
  continue: 'Continue',
  back: 'Back',
} as const;
