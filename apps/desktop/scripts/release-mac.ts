/** Build a signed and notarized macOS DMG from validated release credentials. */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { adaptMacReleaseEnvironment, assertMacReleaseReady } from './release-preflight'

const RELEASE_VARIABLES = [
  'APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_ID',
  'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID', 'APPLE_KEYCHAIN',
  'APPLE_KEYCHAIN_PROFILE', 'APPLE_TEAM_ID', 'CSC_KEY_PASSWORD',
  'CSC_LINK', 'CSC_NAME', 'MACOS_SIGN_IDENTITY', 'MAC_CERT_P12_BASE64',
] as const

function sanitizedEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env }
  for (const name of RELEASE_VARIABLES) delete sanitized[name]
  return sanitized
}

function listCodeSigningIdentities(): string {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`security find-identity exited with ${String(result.status)}`)
  return result.stdout
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

/** Build the macOS artifact while exposing release secrets only to Electron Builder. */
export function releaseMac(): void {
  const releaseEnvironment = adaptMacReleaseEnvironment(process.env)
  const result = assertMacReleaseReady({
    env: releaseEnvironment,
    platform: process.platform,
    listCodeSigningIdentities,
  })
  console.log(
    `macOS release preflight passed: ${result.identity}; signing via ${result.signing}; notarization via ${result.notarization}`,
  )
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const buildEnvironment = sanitizedEnvironment(releaseEnvironment)
  run('pnpm', ['--workspace-root', 'run', 'build'], desktopRoot, buildEnvironment)
  run('node', ['--import', 'tsx', 'scripts/stage-runtime.ts'], desktopRoot, buildEnvironment)
  run('pnpm', [
    'exec', 'electron-builder', '--mac', 'dmg',
    '--config.forceCodeSigning=true', '--config.mac.notarize=true',
  ], desktopRoot, releaseEnvironment)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    releaseMac()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
