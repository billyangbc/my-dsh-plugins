/** Install, assert, and remove every dsh.bundle package in a throwaway profile. */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { root, readBundles, readPatchRows } from './lib/discover.mjs'

const bundles = readBundles()
if (bundles.length === 0) {
  console.log('check-bundles: no bundles found')
  process.exit(0)
}
for (const bundle of bundles) {
  const rows = readPatchRows(bundle.path)
  if (rows.length === 0) throw new Error(`check-bundles: ${bundle.dir} declares dsh.bundle but cordis.patch.yml has no rows`)
  console.log(`check-bundles: ${bundle.manifest.name}`)
  execFileSync(process.execPath, [join(root, 'fixtures/bundle-check.mjs'), bundle.path, ...rows], { stdio: 'inherit', cwd: root, env: process.env })
}
