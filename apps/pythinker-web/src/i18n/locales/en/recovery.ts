export default {
  title: 'Pythinker Code cannot reach a model',
  noProvider: 'No model provider is configured any more. Your sessions and history are untouched.',
  noModel:
    '{provider} is connected, but none of its models can run a conversation right now. Your sessions and history are untouched.',
  credential:
    '{provider} rejected the last request — the API key or sign-in looks expired. Your sessions and history are untouched.',
  fixProvider: 'Open provider settings',
  fixProviderDesc: 'Update the credential or pick a different model',
  addProvider: 'Connect a different provider',
  addProviderDesc: 'Keeps everything else as it is',
  retry: 'Retry connection',
  dismiss: 'Continue offline',
  offlineNotice: 'Working offline — reconnect a provider to send messages.',
} as const;
