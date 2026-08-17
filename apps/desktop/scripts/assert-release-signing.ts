/** Fail a tagged desktop release that would ship an unsigned or un-notarized macOS build. */

import { spawnSync } from 'node:child_process'
import { assertMacReleaseReady } from './release-preflight'

function listCodeSigningIdentities(): string {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`security find-identity exited with ${String(result.status)}`)
  return result.stdout
}

try {
  const result = assertMacReleaseReady({
    env: process.env,
    platform: process.platform,
    listCodeSigningIdentities,
  })
  console.log(
    `macOS release signing is configured: ${result.identity}; signing via ${result.signing}; notarization via ${result.notarization}`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
