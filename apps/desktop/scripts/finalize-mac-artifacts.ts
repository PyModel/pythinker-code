/** Notarize and staple built DMGs, then repair their update metadata. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import { resolveNotarizationCredentials } from './release-preflight'

export interface CommandResult {
  readonly status: number | null
  readonly stderr: string
  readonly stdout: string
}

export type CommandRunner = (command: string, args: readonly string[]) => CommandResult

export interface FinalizeMacArtifactsOptions {
  readonly distDir: string
  readonly env: NodeJS.ProcessEnv
  readonly log?: (message: string) => void
  readonly runCommand?: CommandRunner
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
  return env[name]!.trim()
}

/** Build the notarytool credential arguments selected by the release preflight. */
export function buildNotarytoolArguments(env: NodeJS.ProcessEnv): readonly string[] {
  switch (resolveNotarizationCredentials(env)) {
    case 'api-key':
      return [
        '--key', requiredValue(env, 'APPLE_API_KEY'),
        '--key-id', requiredValue(env, 'APPLE_API_KEY_ID'),
        '--issuer', requiredValue(env, 'APPLE_API_ISSUER'),
      ]
    case 'apple-id':
      return [
        '--apple-id', requiredValue(env, 'APPLE_ID'),
        '--password', requiredValue(env, 'APPLE_APP_SPECIFIC_PASSWORD'),
        '--team-id', requiredValue(env, 'APPLE_TEAM_ID'),
      ]
    case 'keychain-profile': {
      const args = ['--keychain-profile', requiredValue(env, 'APPLE_KEYCHAIN_PROFILE')]
      const keychain = env['APPLE_KEYCHAIN']?.trim()
      if (keychain !== undefined && keychain !== '') args.push('--keychain', keychain)
      return args
    }
  }
}

function yamlScalar(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) return trimmed.slice(1, -1)
  return trimmed
}

/** Update all checksum and size fields associated with one DMG. */
export function rewriteLatestMacYaml(
  yaml: string,
  filename: string,
  sha512: string,
  size: number,
): string {
  const lines = yaml.split('\n')
  let fileEntryIndent: number | undefined
  let topLevelPathMatches = false
  let checksumUpdates = 0
  let sizeUpdates = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const indentation = line.search(/\S|$/)
    const url = line.match(/^(\s*)-\s+url:\s*(.+?)\s*$/)
    if (url !== null) {
      fileEntryIndent = yamlScalar(url[2]!) === filename ? url[1]!.length : undefined
      continue
    }

    if (fileEntryIndent !== undefined) {
      if (line.trim() !== '' && indentation <= fileEntryIndent) {
        fileEntryIndent = undefined
      } else {
        const checksum = line.match(/^(\s*)sha512:\s*.*$/)
        if (checksum !== null) {
          lines[index] = `${checksum[1]}sha512: ${sha512}`
          checksumUpdates += 1
          continue
        }
        const artifactSize = line.match(/^(\s*)size:\s*.*$/)
        if (artifactSize !== null) {
          lines[index] = `${artifactSize[1]}size: ${String(size)}`
          sizeUpdates += 1
          continue
        }
      }
    }

    if (topLevelPathMatches) {
      if (line.startsWith('sha512:')) {
        lines[index] = `sha512: ${sha512}`
        checksumUpdates += 1
        continue
      }
      if (line.startsWith('size:')) {
        lines[index] = `size: ${String(size)}`
        sizeUpdates += 1
        continue
      }
      if (line.trim() !== '' && indentation === 0) topLevelPathMatches = false
    }

    const path = line.match(/^path:\s*(.+?)\s*$/)
    if (path !== null) topLevelPathMatches = yamlScalar(path[1]!) === filename
  }

  if (checksumUpdates === 0 || sizeUpdates === 0) {
    throw new Error(`latest-mac.yml does not contain complete metadata for ${filename}`)
  }
  return lines.join('\n')
}

function defaultCommandRunner(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stderr: result.stderr, stdout: result.stdout }
}

/** Finalize every DMG in the supplied desktop distribution directory. */
export function finalizeMacArtifacts(options: FinalizeMacArtifactsOptions): void {
  const runCommand = options.runCommand ?? defaultCommandRunner
  const log = options.log ?? console.log
  const dmgs = readdirSync(options.distDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.dmg'))
    .map(entry => entry.name)
    .sort()
  if (dmgs.length === 0) throw new Error(`No DMG artifacts found in ${options.distDir}`)

  const metadataPath = join(options.distDir, 'latest-mac.yml')
  let metadata = readFileSync(metadataPath, 'utf8')
  const credentialArgs = buildNotarytoolArguments(options.env)

  for (const filename of dmgs) {
    const dmgPath = join(options.distDir, filename)
    const notarization = runCommand('xcrun', [
      'notarytool', 'submit', dmgPath, '--wait', '--output-format', 'json', ...credentialArgs,
    ])
    const notaryOutput = [notarization.stdout.trim(), notarization.stderr.trim()].filter(Boolean).join('\n')
    if (notaryOutput !== '') log(notaryOutput)
    if (notarization.status !== 0) {
      throw new Error(`notarytool failed for ${filename} with status ${String(notarization.status)}:\n${notaryOutput}`)
    }

    let status: unknown
    try {
      status = (JSON.parse(notarization.stdout) as { readonly status?: unknown }).status
    } catch {
      throw new Error(`notarytool returned invalid JSON for ${filename}:\n${notaryOutput}`)
    }
    if (status !== 'Accepted') {
      throw new Error(`notarytool did not accept ${filename} (status: ${String(status)}):\n${notaryOutput}`)
    }

    const stapling = runCommand('xcrun', ['stapler', 'staple', dmgPath])
    const staplerOutput = [stapling.stdout.trim(), stapling.stderr.trim()].filter(Boolean).join('\n')
    if (staplerOutput !== '') log(staplerOutput)
    if (stapling.status !== 0) {
      throw new Error(`stapler failed for ${filename} with status ${String(stapling.status)}:\n${staplerOutput}`)
    }

    const size = statSync(dmgPath).size
    const sha512 = createHash('sha512').update(readFileSync(dmgPath)).digest('base64')
    metadata = rewriteLatestMacYaml(metadata, filename, sha512, size)

    const blockmapPath = `${dmgPath}.blockmap`
    if (existsSync(blockmapPath)) {
      unlinkSync(blockmapPath)
      log(`Removed stale ${basename(blockmapPath)} because stapling changed the DMG; electron-updater will use a full download.`)
    }
  }

  writeFileSync(metadataPath, metadata)
}
