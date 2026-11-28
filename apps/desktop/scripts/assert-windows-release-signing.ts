/** Fail a tagged desktop release unless Windows signing is complete or the maintainers chose to ship it unsigned. */

import { requireWindowsReleaseSigning } from './package-win'

try {
  const publisher = requireWindowsReleaseSigning(process.env)
  if (publisher === undefined) {
    console.log('::warning::WINDOWS_SIGNING=none: this Windows release is unsigned. SmartScreen warns on install, and installs signed by an earlier publisher cannot update to it in the app.')
  } else {
    console.log(`Windows release signing is configured for ${publisher}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
