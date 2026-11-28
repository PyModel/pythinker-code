/** Fail a Windows release before packaging when Azure Artifact Signing refuses the release credentials. */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DATA_PLANE_API_VERSION = '2023-06-15-preview'
const REFUSED_HINT = 'Azure refuses signing when the subscription is disabled (for example, for an overdue invoice) '
  + 'or when the client has no Artifact Signing Certificate Profile Signer role on the account. '
  + 'Fix that in the Azure portal, then rerun this job.'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const trimmed = env[name]?.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Ask Azure Artifact Signing for the profile's certificate chain with the release credentials.
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

  const tokenResponse = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://codesigning.azure.net/.default',
    }),
  })
  if (!tokenResponse.ok) {
    throw new Error(`Microsoft Entra rejected the Azure signing client (HTTP ${String(tokenResponse.status)}). `
      + 'Check AZURE_TENANT_ID, AZURE_CLIENT_ID and that AZURE_CLIENT_SECRET has not expired.')
  }
  const token = (await tokenResponse.json() as { readonly access_token?: unknown }).access_token
  if (typeof token !== 'string' || token === '') throw new Error('Microsoft Entra returned no access token for Azure signing.')

  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`
  const url = new URL(`codesigningaccounts/${encodeURIComponent(account)}/certificateprofiles/${encodeURIComponent(profile)}/sign/certchain`, base)
  url.searchParams.set('api-version', DATA_PLANE_API_VERSION)
  const response = await fetchImpl(url.toString(), { headers: { authorization: `Bearer ${token}` } })
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Azure Artifact Signing refused the release credentials (HTTP ${String(response.status)}).\n${REFUSED_HINT}`)
  }
  if (!response.ok) return `Azure Artifact Signing answered HTTP ${String(response.status)}; packaging will surface any real signing failure.`
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
