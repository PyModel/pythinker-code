/** Fail a tagged desktop release unless Windows signing is complete. */

import { requireWindowsReleaseSigning } from './package-win'

try {
  console.log(`Windows release signing is configured for ${requireWindowsReleaseSigning(process.env)}`)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
