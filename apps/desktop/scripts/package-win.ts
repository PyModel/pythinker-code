/** Package the Windows NSIS installer with optional Azure Artifact Signing. */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageManagerInvocation } from './stage-runtime'

function trimmedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Return Electron Builder overrides when all Azure signing settings are configured. */
export function windowsSigningArgs(env: NodeJS.ProcessEnv): readonly string[] {
  const values: readonly (readonly [string, string | undefined])[] = [
    ['AZURE_TENANT_ID', trimmedValue(env['AZURE_TENANT_ID'])],
    ['AZURE_CLIENT_ID', trimmedValue(env['AZURE_CLIENT_ID'])],
    ['AZURE_CLIENT_SECRET', trimmedValue(env['AZURE_CLIENT_SECRET'])],
    ['AZURE_SIGNING_ENDPOINT', trimmedValue(env['AZURE_SIGNING_ENDPOINT'])],
    ['AZURE_SIGNING_ACCOUNT', trimmedValue(env['AZURE_SIGNING_ACCOUNT'])],
    ['AZURE_SIGNING_CERT_PROFILE', trimmedValue(env['AZURE_SIGNING_CERT_PROFILE'])],
    ['AZURE_SIGNING_PUBLISHER_NAME', trimmedValue(env['AZURE_SIGNING_PUBLISHER_NAME'])],
  ]
  const missing: string[] = []
  const args: string[] = []
  for (const [name, value] of values) {
    if (value === undefined) {
      missing.push(name)
      continue
    }

    switch (name) {
      case 'AZURE_SIGNING_ENDPOINT':
        args.push('--config.win.azureSignOptions.endpoint', value)
        break
      case 'AZURE_SIGNING_ACCOUNT':
        args.push('--config.win.azureSignOptions.codeSigningAccountName', value)
        break
      case 'AZURE_SIGNING_CERT_PROFILE':
        args.push('--config.win.azureSignOptions.certificateProfileName', value)
        break
      case 'AZURE_SIGNING_PUBLISHER_NAME':
        args.push('--config.win.azureSignOptions.publisherName', value)
        break
    }
  }
  missing.sort()

  const certificateValues: readonly (readonly [string, string | undefined])[] = [
    ['WIN_CSC_LINK', trimmedValue(env['WIN_CSC_LINK'])],
    ['WIN_CSC_KEY_PASSWORD', trimmedValue(env['WIN_CSC_KEY_PASSWORD'])],
    ['WINDOWS_SIGNING_PUBLISHER_NAME', trimmedValue(env['WINDOWS_SIGNING_PUBLISHER_NAME'])],
  ]
  const missingCertificateValues = certificateValues
    .filter(([, value]) => value === undefined)
    .map(([name]) => name)
  const hasCertificateValue = missingCertificateValues.length < certificateValues.length
  const hasAzureValue = missing.length < values.length

  if (hasCertificateValue && missingCertificateValues.length > 0) {
    throw new Error(
      `Windows certificate signing is partially configured; missing: ${missingCertificateValues.join(', ')}. Set all three signing variables or none.`,
    )
  }
  if (hasAzureValue && hasCertificateValue) {
    throw new Error('Choose one Windows signing method; Azure and certificate signing are both configured.')
  }

  if (!hasAzureValue && !hasCertificateValue) return []
  if (hasAzureValue && missing.length > 0) {
    throw new Error(
      `Windows signing is partially configured; missing: ${missing.join(', ')}. Set all seven signing variables or none.`,
    )
  }

  const publisherName = hasAzureValue
    ? trimmedValue(env['AZURE_SIGNING_PUBLISHER_NAME'])!
    : trimmedValue(env['WINDOWS_SIGNING_PUBLISHER_NAME'])!
  if (!hasAzureValue) args.length = 0
  args.push('--config.win.publisherName', publisherName)
  return args
}

/** Require one complete signing method for a tagged Windows release. */
export function requireWindowsReleaseSigning(env: NodeJS.ProcessEnv): string {
  const args = windowsSigningArgs(env)
  if (args.length === 0) throw new Error('Windows release signing is not configured')
  return trimmedValue(env['AZURE_SIGNING_PUBLISHER_NAME'])
    ?? trimmedValue(env['WINDOWS_SIGNING_PUBLISHER_NAME'])!
}

/** Return the package-manager invocation for a Windows installer build. */
export function windowsPackageInvocation(platform: string, env: NodeJS.ProcessEnv, publish: string): {
  readonly command: string
  readonly args: readonly string[]
  readonly shell: boolean
} {
  const args = ['exec', 'electron-builder', '--win', 'nsis', '--x64', '--publish', publish, ...windowsSigningArgs(env)]
  return packageManagerInvocation(platform, 'pnpm', args)
}

/** Package the Windows installer and optionally sign it through Azure Artifact Signing. */
export function packageWin(options: { readonly publish: string }): void {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const invocation = windowsPackageInvocation(process.platform, process.env, options.publish)
  const result = spawnSync(invocation.command, invocation.args, { cwd: desktopRoot, stdio: 'inherit', shell: invocation.shell })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`electron-builder exited with ${String(result.status)}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const publishIndex = process.argv.indexOf('--publish')
    packageWin({ publish: publishIndex === -1 ? 'never' : (process.argv[publishIndex + 1] ?? 'never') })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
