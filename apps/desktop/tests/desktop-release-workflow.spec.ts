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
    expect(workflow).toContain("publish: ${{ steps.resolve.outputs.publish }}")
    expect(workflow).toContain("if: needs.prepare.outputs.publish == 'true'")
    expect(workflow).toContain("if: needs.prepare.outputs.publish != 'true'")
  })

  it('uses one signed build path for Stable, Beta, and Nightly feeds', () => {
    expect(workflow).toContain('workflow_call:')
    expect(workflow).toContain('type: choice')
    expect(workflow).toContain('options: [stable, beta, nightly]')
    expect(workflow).toContain('scripts/desktop-release.mjs resolve')
    expect(workflow).toContain('PUBLISH_NIGHTLY: ${{ inputs.publish_nightly }}')
    expect(workflow.match(/scripts\/desktop-release\.mjs configure/gu)).toHaveLength(2)
    expect(workflow).toContain('needs.prepare.outputs.mac_manifest')
    expect(workflow).toContain('needs.prepare.outputs.win_manifest')
    expect(workflow).toContain('--prerelease')
  })

  it('runs every signing gate on a manual rehearsal, not only on a tag', () => {
    // A manual run is the only chance to prove the signing path before the tag
    // that depends on it. Gating these behind the tag would make a rehearsal
    // pass while the credentials it was meant to exercise were already broken.
    const rehearsed = [
      'scripts/assert-release-signing.ts',
      'scripts/assert-windows-release-signing.ts',
      'scripts/verify-windows-signatures.ts',
      'xcrun stapler validate',
    ]
    for (const step of rehearsed) {
      const stepIndex = workflow.indexOf(step)
      expect(stepIndex).toBeGreaterThan(-1)
      const precedingStep = workflow.lastIndexOf('      - name:', stepIndex)
      // Any condition at all, not just a tag test, would skip one trigger:
      // `github.event_name == 'workflow_dispatch'` reintroduces the same hole
      // from the other side. These steps must be unconditional.
      const declaration = workflow.slice(precedingStep, stepIndex)
      expect(declaration).not.toMatch(/^\s+if:/mu)
    }
  })

  it('downloads and revalidates uploaded assets before publishing', () => {
    expect(workflow).toContain('gh release download "$RELEASE_TAG"')
    expect(workflow).toContain('scripts/verify-update-manifest.ts mac release-assets')
    expect(workflow).toContain('scripts/verify-update-manifest.ts win release-assets')
  })

  it('refuses to overwrite an existing published release', () => {
    expect(workflow).toContain('--json body,isDraft,isPrerelease')
    expect(workflow).toContain('belongs to a different source commit')
    expect(workflow).toContain('already exists and is published; refusing to replace live assets')
    expect(workflow).toContain('Nightly release ${RELEASE_TAG} already exists; no new main commit to publish.')
  })

  it('limits release tokens to repository contents writes', () => {
    expect(workflow.match(/permission-contents: write/gu)).toHaveLength(4)
  })

  it('pins the updater version used by the manifest parser', () => {
    expect(desktopPackage.devDependencies['electron-updater']).toBe('6.8.9')
  })
})
