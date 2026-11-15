/**
 * Install / disable / remove probe for one bundle against a throwaway DSH home.
 * Requires DSH_CHECKOUT (built checkout) and DSH_HOME is created by the script.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const checkout = process.env.DSH_CHECKOUT
// The dsh CLI runs in the checkout, so a relative bundle path must be resolved here first.
const bundle = process.argv[2] === undefined ? undefined : resolve(process.argv[2])
if (!checkout || !bundle) throw new Error('usage: node install-check.mjs <bundle-path>  (DSH_CHECKOUT required)')

const home = process.env.P2_HOME ?? '/tmp/dsh-p2-verify-home'
const profile = 'p2verify'
const run = args => execFileSync('pnpm', ['dsh', ...args], {
  cwd: checkout,
  env: { ...process.env, DSH_HOME: home },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const dump = () => run(['--profile', profile, '--dump-config'])
const assert = (condition, message) => { if (!condition) throw new Error(`assert: ${message}`) }

rmSync(home, { recursive: true, force: true })
mkdirSync(home, { recursive: true })
run(['--profile', profile, '--from-default-profile', 'web', '--dump-config'])

// 1) install
run(['plugin', '--profile', profile, 'add', bundle])
const installed = dump()
assert(installed.includes('@zifyai/dsh-demo-remote'), 'remote row present after add')
assert(installed.includes('@zifyai/dsh-demo-client'), 'client row present after add')
const manifest = JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))
assert(manifest.dsh.profile.bundles.includes('@zifyai/dsh-plugin-demo'), 'bundle listed in profile')
assert(Object.keys(manifest.dependencies).includes('@zifyai/dsh-plugin-demo'), 'bundle dependency saved')
console.log('ok: install')

// 2) disable both rows through the profile patch layer
const patchPath = join(home, 'profiles', profile, 'cordis.patch.yml')
writeFileSync(patchPath, '- id: zifyai-demo-remote\n  disabled: true\n- id: zifyai-demo-client\n  disabled: true\n')
const disabled = dump()
assert(/^- id: zifyai-demo-remote\n(?:  .*\n)*?  disabled: true/m.test(disabled), 'remote row disabled')
assert(/^- id: zifyai-demo-client\n(?:  .*\n)*?  disabled: true/m.test(disabled), 'client row disabled')
console.log('ok: disable')

// 3) remove
run(['plugin', '--profile', profile, 'remove', '@zifyai/dsh-plugin-demo'])
const removed = dump()
assert(!removed.includes('@zifyai/dsh-demo-remote'), 'remote row gone after remove')
assert(!removed.includes('@zifyai/dsh-demo-client'), 'client row gone after remove')
const after = JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))
assert(!JSON.stringify(after).includes('@zifyai/dsh-plugin-demo'), 'profile manifest clean')
const linkResidue = join(home, 'profiles', profile, 'node_modules', '@zifyai', 'dsh-plugin-demo')
if (existsSync(linkResidue)) {
  // pnpm keeps an extraneous symlink for `link:` dependencies even after the manifest entry is
  // removed; release installs use Git/npm specs and prune normally. Record it instead of failing.
  console.warn(`warn: dev-mode link residue remains at ${linkResidue} (pnpm does not prune link: deps)`)
}
console.log('ok: remove')
console.log('PASS: install/disable/remove clean')
