/**
 * Uninstall audit: for each discovered bundle and for all bundles together, install
 * into a fresh profile, assert rows appear in --dump-config, remove, then assert rows
 * and manifest references are gone.
 *
 * Usage: DSH_CHECKOUT=<checkout> node fixtures/uninstall-audit.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { root, readBundles, readPatchRows } from '../tooling/lib/discover.mjs'

const bundles = readBundles().map((bundle) => ({ dir: bundle.dir, name: bundle.manifest.name, rows: readPatchRows(bundle.path) }))
if (bundles.length === 0) {
  console.log('uninstall-audit: no bundles found')
  process.exit(0)
}
const checkout = process.env.DSH_CHECKOUT
if (!checkout) throw new Error('DSH_CHECKOUT is required')
const home = '/tmp/dsh-uninstall-audit'
rmSync(home, { recursive: true, force: true })

const run = (args) => execFileSync('pnpm', ['dsh', ...args], {
  cwd: checkout,
  env: { ...process.env, DSH_HOME: home },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const dump = (profile) => run([`--profile`, profile, '--dump-config'])
const createProfile = (profile) => { run([`--profile`, profile, '--from-default-profile', 'web', '--dump-config']) }
const add = (profile, dir) => { run(['plugin', `--profile`, profile, 'add', join(root, 'packages', dir)]) }
const remove = (profile, name) => { run(['plugin', `--profile`, profile, 'remove', name]) }
const manifest = (profile) => JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))

const results = []
const audit = (profile, label, bundle) => {
  const selected = bundle === undefined ? bundles : [bundle]
  createProfile(profile)
  for (const item of selected) add(profile, item.dir)
  const before = dump(profile)
  for (const item of selected) {
    for (const row of item.rows) {
      if (!before.includes(`- id: ${row}`)) throw new Error(`${label}: missing row ${row} before remove`)
    }
  }
  for (const item of selected) remove(profile, item.name)
  const after = dump(profile)
  if (after.includes('zifyai-')) throw new Error(`${label}: zifyai rows remain after remove`)
  const refs = manifest(profile).dsh?.profile?.bundles ?? []
  if (refs.some(ref => String(ref).includes('@zifyai/dsh-plugin-'))) throw new Error(`${label}: manifest still references a bundle`)
  const residue = existsSync(join(home, 'profiles', profile, 'node_modules', '@zifyai'))
  results.push({ label, rowsRemoved: true, manifestClean: true, linkResidue: residue })
}

for (const bundle of bundles) audit(`audit-${bundle.dir}`, bundle.dir, bundle)
audit('audit-all', 'all-bundles')

console.log(JSON.stringify(results, null, 2))
