/** Run every fixtures/*-provider-check.mjs in name order; a bare scaffold has none. */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './lib/discover.mjs'

const fixtures = join(root, 'fixtures')
const checks = existsSync(fixtures) ? readdirSync(fixtures).filter((name) => name.endsWith('-provider-check.mjs')).sort() : []
if (checks.length === 0) {
  console.log('run-provider-checks: no provider checks found')
  process.exit(0)
}
for (const name of checks) {
  console.log(`run-provider-checks: ${name}`)
  execFileSync(process.execPath, [join(fixtures, name)], { stdio: 'inherit', cwd: root, env: process.env })
}
