/** Fail a macOS release before packaging when Apple's notary service rejects the account. */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNotarytoolArguments, defaultCommandRunner, type CommandRunner } from './finalize-mac-artifacts'

const AGREEMENT_HINT = 'The Apple Developer account holder must accept the current agreements in the Apple Developer account and App Store Connect, then rerun this job.'

/**
 * Ask notarytool for the submission history with the release credentials.
 * @param env - Environment that carries the notarization credentials.
 * @param runCommand - Command runner, replaced in tests.
 */
export function checkNotaryAccess(env: NodeJS.ProcessEnv, runCommand: CommandRunner = defaultCommandRunner): void {
  const result = runCommand('xcrun', ['notarytool', 'history', '--output-format', 'json', ...buildNotarytoolArguments(env)])
  if (result.status === 0) return
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')
  const hint = /agreement/iu.test(output) ? `\n${AGREEMENT_HINT}` : ''
  throw new Error(`Apple notary service rejected the release credentials (status ${String(result.status)}):\n${output}${hint}`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    checkNotaryAccess(process.env)
    console.log('Apple notary service accepted the release credentials.')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
