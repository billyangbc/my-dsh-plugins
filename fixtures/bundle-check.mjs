/**
 * Generic bundle install/remove probe: add, assert rows, remove, assert clean.
 * Usage: node bundle-check.mjs <bundle-path> <row-id> [<row-id>...]
 * Requires DSH_CHECKOUT (built checkout).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const checkout = process.env.DSH_CHECKOUT
const [bundleArg, ...rows] = process.argv.slice(2)
if (!checkout || !bundleArg || rows.length === 0) throw new Error('usage: node bundle-check.mjs <bundle> <row-id>... (DSH_CHECKOUT required)')
const bundle = resolve(bundleArg)
const home = process.env.P2_HOME ?? '/tmp/dsh-bundle-check-home'
const profile = 'bundlecheck'

const run = args => execFileSync('pnpm', ['dsh', ...args], {
  cwd: checkout, env: { ...process.env, DSH_HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})
const dump = () => run(['--profile', profile, '--dump-config'])
const assert = (condition, message) => { if (!condition) throw new Error(`assert: ${message}`) }

rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
run(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
run(['plugin', '--profile', profile, 'add', bundle])
const installed = dump()
for (const row of rows) assert(installed.includes(`- id: ${row}`), `${row} present after add`)
const manifest = JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))
const bundleName = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8')).name
assert(manifest.dsh.profile.bundles.includes(bundleName), 'bundle listed in profile')
run(['plugin', '--profile', profile, 'remove', bundleName])
const removed = dump()
for (const row of rows) assert(!removed.includes(`- id: ${row}`), `${row} gone after remove`)
assert(!JSON.stringify(JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))).includes(bundleName), 'profile manifest clean')
const residue = join(home, 'profiles', profile, 'node_modules', '@zifyai', bundleName.split('/')[1])
if (existsSync(residue)) console.warn(`warn: dev-mode link residue remains at ${residue}`)
console.log(`PASS: ${bundleName} install/remove (${rows.join(', ')})`)
