/**
 * Verify that a checkout's product paths are byte-identical to an upstream ref.
 * Usage: node tooling/verify-zero-diff.mjs <checkout> [ref]
 */
import { spawnSync } from 'node:child_process'

const checkout = process.argv[2]
const ref = process.argv[3] ?? 'base/upstream'
if (checkout === undefined) {
  console.error('usage: node tooling/verify-zero-diff.mjs <checkout> [ref]')
  process.exit(2)
}

const paths = [
  'packages', 'apps', 'vendor',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.json', 'tsconfig.base.json', 'tsconfig.host.json', 'tsconfig.client.json',
]

const result = spawnSync('git', ['diff', '--stat', ref, '--', ...paths], { cwd: checkout, encoding: 'utf8' })
if (result.status !== 0) {
  console.error(result.stderr.trim() || `git diff exited ${String(result.status)}`)
  process.exit(result.status ?? 1)
}
if (result.stdout.trim() !== '') {
  console.error(`zero-diff gate failed against ${ref}:\n${result.stdout.trim()}`)
  process.exit(1)
}
console.log(`zero-diff gate passed against ${ref}`)
