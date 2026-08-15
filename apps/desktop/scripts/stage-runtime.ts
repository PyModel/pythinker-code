/** Materialize the packaged desktop Host dependency closure. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const desktopRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(desktopRoot, '../..')
const staging = join(desktopRoot, 'runtime-host')
const deployPackage = '@pymodel/pythinker-code'
const entry = join(staging, 'node_modules/@pymodel/pythinker-code/dist/launcher.mjs')
const frontend = join(staging, 'node_modules/@pymodel/pythinker-code/dist-web/index.html')
const workspaceState = join(repositoryRoot, 'node_modules/.pnpm-workspace-state-v1.json')

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: { ...process.env, CI: 'true' }, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) accept()
      else reject(new Error(`desktop runtime staging failed (${code === null ? `signal ${String(signal)}` : `exit ${String(code)}`}): ${command} ${args.join(' ')}`))
    })
  })
}

async function findSymlink(directory: string): Promise<string | undefined> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) return path
    if (metadata.isDirectory()) {
      const nested = await findSymlink(path)
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

async function materializeLinks(): Promise<void> {
  const nodeModules = join(staging, 'node_modules')
  for (let link = await findSymlink(nodeModules); link !== undefined; link = await findSymlink(nodeModules)) {
    const segments = link.slice(nodeModules.length + 1).split(sep)
    const bin = segments.lastIndexOf('.bin')
    if (bin >= 0) {
      await rm(join(nodeModules, ...segments.slice(0, bin + 1)), { recursive: true, force: true })
      continue
    }
    const source = await realpath(link)
    await rm(link, { recursive: true, force: true })
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: path => path !== join(source, 'node_modules') && !path.startsWith(join(source, 'node_modules') + sep),
    })
  }
}

async function deploy(target: string): Promise<void> {
  const savedWorkspaceState = existsSync(workspaceState) ? await readFile(workspaceState) : undefined
  try {
    await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', [
      '--config.verify-deps-before-run=false', '--filter', deployPackage, 'deploy', '--legacy', '--prod',
      '--config.node-linker=hoisted', '--config.auto-install-peers=false', '--config.link-workspace-packages=true', target,
    ])
  } finally {
    if (savedWorkspaceState === undefined) await rm(workspaceState, { force: true })
    else await writeFile(workspaceState, savedWorkspaceState)
  }
}

async function main(): Promise<void> {
  const deployed = await mkdtemp(join(tmpdir(), 'pythinker-desktop-runtime-'))
  try {
    await deploy(deployed)
    await rm(join(staging, 'node_modules'), { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    await cp(join(deployed, 'node_modules'), join(staging, 'node_modules'), {
      recursive: true,
    })
    const runtimePackage = join(staging, 'node_modules/@pymodel/pythinker-code')
    await mkdir(runtimePackage, { recursive: true })
    for (const name of ['package.json', 'dist', 'dist-web']) {
      await cp(join(deployed, name), join(runtimePackage, name), {
        recursive: true,
        dereference: true,
      })
    }
    await materializeLinks()
  } finally {
    await rm(deployed, { recursive: true, force: true })
  }
  if (!existsSync(entry)) throw new Error(`desktop Host entry missing after staging: ${entry}`)
  if (!existsSync(frontend)) throw new Error(`desktop Web frontend missing after staging: ${frontend}`)
  console.log(`desktop runtime staged at ${staging}`)
}

await main()
