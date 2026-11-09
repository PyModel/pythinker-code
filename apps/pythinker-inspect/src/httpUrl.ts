/** Build an absolute API URL under a resolved inspect base (loopback http(s) only). */
export function joinApiUrl(baseUrl: string, apiPath: string): string {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${base.protocol}`);
  }
  const path = apiPath.startsWith('/') ? apiPath.slice(1) : apiPath;
  return new URL(path, base).href;
}
