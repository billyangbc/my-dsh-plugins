/**
 * Fallback Typert generation: temporarily add this workspace's Remote packages to a
 * DSH source checkout, run the repository generator, copy artifacts back, restore.
 *
 * Requires DSH_CHECKOUT to name a checkout with dependencies installed. A workspace
 * with no Typert contributors (a bare scaffold) is a no-op.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, readPackages } from './lib/discover.mjs'

// Contributors are discovered from the `exports["./typert"]` face of each package.
const packages = readPackages()
  .filter((entry) => entry.manifest.exports?.['./typert'] !== undefined && existsSync(join(entry.path, 'src')))
  .map((entry) => ({ dir: entry.dir }))
if (packages.length === 0) {
  console.log('generate-via-checkout: no Typert contributors; skipped')
  process.exit(0)
}

const checkout = process.env.DSH_CHECKOUT
if (!checkout) throw new Error('DSH_CHECKOUT is required (path to a deepseek-harness checkout)')

// A per-process suffix keeps two concurrent builds from writing the same directories in one checkout.
const suffix = `-${String(process.pid)}`

const aggregate = join(checkout, 'tsconfig.host.json')
const aggregateBackup = readFileSync(aggregate, 'utf8')
const tempRoot = join(checkout, 'packages', 'extensions')
mkdirSync(tempRoot, { recursive: true })

const cleanup = []
/** Restore the checkout and drop every temporary package. */
const restore = () => {
  writeFileSync(aggregate, aggregateBackup)
  for (const target of cleanup) rmSync(target, { recursive: true, force: true })
}
// An interrupted build must not leave the shared checkout modified.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restore()
    process.exit(130)
  })
}
try {
  const entries = packages.map((entry) => ({ ...entry, temp: `zifyai-${entry.dir}${suffix}` }))
  for (const entry of entries) {
    const source = join(root, 'packages', entry.dir)
    const target = join(tempRoot, entry.temp)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(join(source, 'src'), join(target, 'src'), { recursive: true })
    cpSync(join(source, 'package.json'), join(target, 'package.json'))
    writeFileSync(join(target, 'tsconfig.json'), JSON.stringify({
      extends: '../../../tsconfig.base.json',
      compilerOptions: {
        composite: true,
        rootDir: 'src',
        outDir: 'lib/types',
        declarationDir: 'lib/types',
      },
      include: ['src'],
      references: [
        { path: '../../typert/protocol' },
        { path: '../../util/brand' },
        { path: '../../util/error' },
      ],
    }, null, 2))
    cleanup.push(target)
  }

  const marker = '"references": ['
  const at = aggregateBackup.indexOf(marker)
  if (at < 0) throw new Error('tsconfig.host.json has no references array')
  const inserted = entries.map((entry) => `    { "path": "./packages/extensions/${entry.temp}" },`).join('\n')
  writeFileSync(aggregate, `${aggregateBackup.slice(0, at + marker.length)}\n${inserted}${aggregateBackup.slice(at + marker.length)}`)

  execFileSync('pnpm', ['exec', 'tsx', 'scripts/generate-typert.ts'], { cwd: checkout, stdio: 'inherit' })

  for (const entry of entries) {
    const target = join(tempRoot, entry.temp)
    const out = join(root, 'packages', entry.dir, 'lib')
    mkdirSync(out, { recursive: true })
    for (const file of ['typert.host.js', 'typert.host.d.ts', 'typert.remote-client.js', 'typert.remote-client.d.ts', 'typert.remote-client.d.ts.map', 'typert.host.d.ts.map']) {
      const from = join(target, 'lib', file)
      if (existsSync(from)) copyFileSync(from, join(out, file))
    }
    console.log(`generate-via-checkout: copied ${entry.dir} artifacts`)
  }
} finally {
  restore()
}
