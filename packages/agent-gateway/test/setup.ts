delete process.env['PYTHINKER_CODE_EXPERIMENTAL_FLAG'];
for (const key of Object.keys(process.env)) {
  if (key.startsWith('PYTHINKER_CODE_EXPERIMENTAL_')) {
    delete process.env[key];
  }
}

process.env['PYTHINKER_CODE_EXPERIMENTAL_SEARCH_WORKER'] = 'false';

process.env['PYTHINKER_CODE_EXPERIMENTAL_PERSISTENCE_MINIDB_READMODEL'] = 'false';

const realFetch = globalThis.fetch.bind(globalThis);
const TELEMETRY_HOSTS = new Set(['telemetry-logs.pythinker.com']);
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (TELEMETRY_HOSTS.has(new URL(url).hostname)) {
    throw new Error(`test attempted to send production telemetry to ${url}; stub fetch instead`);
  }
  return realFetch(input, init);
}) as typeof fetch;
