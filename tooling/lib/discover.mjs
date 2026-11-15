/** Shared workspace discovery for the build, test, and audit entry points. */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root: this file lives at <root>/tooling/lib/discover.mjs. */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Every package under packages/*, sorted by directory name, with its parsed manifest. */
export function readPackages() {
  const packages = join(root, 'packages')
  if (!existsSync(packages)) return []
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((dir) => {
      const path = join(packages, dir)
      const manifestPath = join(path, 'package.json')
      if (!existsSync(manifestPath)) return []
      return [{ dir, path, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) }]
    })
}

/** The row ids a bundle's cordis.patch.yml inserts, in declaration order. */
export function readPatchRows(path) {
  const patch = join(path, 'cordis.patch.yml')
  if (!existsSync(patch)) return []
  return [...readFileSync(patch, 'utf8').matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gmu)].map((match) => match[1])
}

/** Every package that declares a dsh.bundle face. */
export function readBundles() {
  return readPackages().filter((entry) => entry.manifest.dsh?.bundle !== undefined)
}

/**
 * Composite packages in dependency order: a package that another package imports
 * is emitted first, so a clean `tsc -b` can resolve its declarations.
 */
export function readBuildOrder() {
  const composites = readPackages().filter((entry) => existsSync(join(entry.path, 'tsconfig.json')))
  const byName = new Map(composites.map((entry) => [entry.manifest.name, entry]))
  const state = new Map()
  const order = []
  const visit = (entry) => {
    const mark = state.get(entry.dir) ?? 'new'
    if (mark === 'done') return
    if (mark === 'visiting') throw new Error(`build order: workspace cycle through ${entry.dir}`)
    state.set(entry.dir, 'visiting')
    const manifest = entry.manifest
    const names = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    for (const name of names) {
      const dependency = byName.get(name)
      if (dependency !== undefined) visit(dependency)
    }
    state.set(entry.dir, 'done')
    order.push(entry)
  }
  for (const entry of composites) visit(entry)
  return order
}
