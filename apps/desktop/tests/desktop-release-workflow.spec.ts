import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(import.meta.dirname, '../../../.github/workflows/desktop-release.yml'),
  'utf8',
)
const desktopPackage = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '../package.json'),
  'utf8',
)) as { readonly devDependencies: Record<string, string> }

describe('desktop release workflow', () => {
  it('builds locally before it uploads either platform', () => {
    expect(workflow).toContain('electron-builder --mac dmg zip --publish never')
    expect(workflow).toContain('scripts/package-win.ts --publish never')
    expect(workflow).not.toContain('electron-builder --mac dmg zip --publish always')
    expect(workflow).not.toContain('scripts/package-win.ts --publish always')
  })

  it('requires signed and notarized macOS artifacts before upload', () => {
    expect(workflow).toContain('codesign --verify --deep --strict')
    expect(workflow).toContain('spctl --assess --type execute')
    expect(workflow).toContain('xcrun stapler validate')
    expect(workflow).toContain('ditto -x -k "$zip_path"')
    expect(workflow).toContain('hdiutil verify "$dmg_path"')
    expect(workflow).toContain('verify_app "$zip_app"')
    expect(workflow).toContain('verify_app "$dmg_app"')
    expect(workflow).toContain('verify-update-manifest.ts mac')
  })

  it('requires Windows signing and verifies the actual release binaries', () => {
    expect(workflow).toContain('scripts/assert-windows-release-signing.ts')
    expect(workflow).toContain('scripts/verify-windows-signatures.ts')
    expect(workflow).toContain('verify-update-manifest.ts win')
  })

  it('never publishes a manual unsigned build to the release feed', () => {
    expect(workflow).toContain("publish:\n    if: startsWith(github.ref, 'refs/tags/desktop-v')")
    expect(workflow).toContain("if: startsWith(github.ref, 'refs/tags/desktop-v')\n        shell: bash\n        env:\n          GH_TOKEN:")
  })

  it('downloads and revalidates uploaded assets before publishing', () => {
    expect(workflow).toContain('gh release download "$RELEASE_TAG"')
    expect(workflow).toContain('scripts/verify-update-manifest.ts mac release-assets')
    expect(workflow).toContain('scripts/verify-update-manifest.ts win release-assets')
  })

  it('refuses to overwrite an existing published release', () => {
    expect(workflow).toContain("--json isDraft --jq '.isDraft'")
    expect(workflow).toContain('already exists and is published; refusing to replace live assets')
  })

  it('limits release tokens to repository contents writes', () => {
    expect(workflow.match(/permission-contents: write/gu)).toHaveLength(4)
  })

  it('pins the updater version used by the manifest parser', () => {
    expect(desktopPackage.devDependencies['electron-updater']).toBe('6.8.9')
  })
})
