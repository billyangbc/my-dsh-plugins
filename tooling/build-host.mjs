/** Generate Typert artifacts through a DSH checkout, then compile every composite package. */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { root, readBuildOrder } from './lib/discover.mjs'
import { syncHostTsconfig } from './sync-host-tsconfig.mjs'

syncHostTsconfig()
execFileSync(process.execPath, [join(root, 'tooling/generate-via-checkout.mjs')], { stdio: 'inherit', cwd: root })

const projects = readBuildOrder().map((entry) => `packages/${entry.dir}`)
if (projects.length === 0) {
  console.log('build-host: no composite packages; skipped tsc')
} else {
  execFileSync('pnpm', ['exec', 'tsc', '-b', ...projects], { stdio: 'inherit', cwd: root })
}
