/** Fail a Windows release before packaging when Azure Artifact Signing refuses the release credentials. */

import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_PLANE_API_VERSION = '2022-06-15-preview'
const REFUSED_HINT = 'Azure refuses signing when the subscription is disabled (for example, for an overdue invoice) '
  + 'or when the client has no Artifact Signing Certificate Profile Signer role on the account. '
  + 'Fix that in the Azure portal, then rerun this job.'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const trimmed = env[name]?.trim()
  return trimmed === '' ? undefined : trimmed
}

function inconclusive(what: string): string {
  return `${what}; packaging will surface any real signing failure.`
}

/** Send one request; a network failure is inconclusive, so it comes back as a warning instead of a rejection. */
async function send(fetchImpl: FetchLike, label: string, url: string, init: RequestInit): Promise<Response | string> {
  try {
    return await fetchImpl(url, init)
  } catch (error) {
    return inconclusive(`${label} request failed (${error instanceof Error ? error.message : String(error)})`)
  }
}

/**
 * Start one signing operation over a random digest with the release credentials.
 * Reading the certificate chain still succeeds while a disabled subscription refuses signing,
 * so only the sign call proves that packaging can sign.
 * @param env - Environment that carries the Azure signing settings.
 * @param fetchImpl - HTTP client, replaced in tests.
 * @returns A warning when the answer is inconclusive, `skipped` when Azure signing is not configured, or undefined.
 */
export async function checkAzureSigningAccess(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch): Promise<string | undefined> {
  const tenant = value(env, 'AZURE_TENANT_ID')
  const clientId = value(env, 'AZURE_CLIENT_ID')
  const clientSecret = value(env, 'AZURE_CLIENT_SECRET')
  const endpoint = value(env, 'AZURE_SIGNING_ENDPOINT')
  const account = value(env, 'AZURE_SIGNING_ACCOUNT')
  const profile = value(env, 'AZURE_SIGNING_CERT_PROFILE')
  if (tenant === undefined || clientId === undefined || clientSecret === undefined
    || endpoint === undefined || account === undefined || profile === undefined) {
    return 'skipped'
  }

  const tokenResponse = await send(fetchImpl, 'Microsoft Entra token', `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://codesigning.azure.net/.default',
    }),
  })
  if (typeof tokenResponse === 'string') return tokenResponse
  // Entra answers 400 for an unknown tenant or client and 401 for a wrong or expired secret.
  if (tokenResponse.status === 400 || tokenResponse.status === 401 || tokenResponse.status === 403) {
    throw new Error(`Microsoft Entra rejected the Azure signing client (HTTP ${String(tokenResponse.status)}). `
      + 'Check AZURE_TENANT_ID, AZURE_CLIENT_ID and that AZURE_CLIENT_SECRET has not expired.')
  }
  if (!tokenResponse.ok) return inconclusive(`Microsoft Entra answered HTTP ${String(tokenResponse.status)}`)
  let token: unknown
  try {
    token = (await tokenResponse.json() as { readonly access_token?: unknown }).access_token
  } catch (error) {
    return inconclusive(`Microsoft Entra token response could not be read (${error instanceof Error ? error.message : String(error)})`)
  }
  if (typeof token !== 'string' || token === '') return inconclusive('Microsoft Entra returned no access token')

  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  const url = new URL(`codesigningaccounts/${encodeURIComponent(account)}/certificateprofiles/${encodeURIComponent(profile)}/sign`, base)
  url.searchParams.set('api-version', DATA_PLANE_API_VERSION)
  const response = await send(fetchImpl, 'Azure Artifact Signing', url.toString(), {
    method: 'POST',
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ signatureAlgorithm: 'RS256', digest: randomBytes(32).toString('base64') }),
  })
  if (typeof response === 'string') return response
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Azure Artifact Signing refused the release credentials (HTTP ${String(response.status)}).\n${REFUSED_HINT}`)
  }
  if (!response.ok) return inconclusive(`Azure Artifact Signing answered HTTP ${String(response.status)}`)
  return undefined
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkAzureSigningAccess(process.env)
    if (result === 'skipped') console.log('Azure Artifact Signing is not configured; nothing to check.')
    else if (result !== undefined) console.warn(`warning: ${result}`)
    else console.log('Azure Artifact Signing accepted the release credentials.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
