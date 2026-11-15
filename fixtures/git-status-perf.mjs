/** Git status performance baseline: 5,000 files, 200 modified. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import GitLocal from '../packages/git-local/lib/index.js'

const root = '/tmp/dsh-git-perf'
execFileSync('rm', ['-rf', root])
mkdirSync(root, { recursive: true })
const git = args => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.email', 'perf@example.com'])
git(['config', 'user.name', 'Perf'])
for (let index = 0; index < 5000; index += 1) writeFileSync(join(root, `file-${String(index)}.txt`), `${String(index)}\n`)
git(['add', '.'])
git(['commit', '-q', '-m', 'seed'])
for (let index = 0; index < 200; index += 1) writeFileSync(join(root, `file-${String(index)}.txt`), `changed ${String(index)}\n`)

const ctx = new Context()
ctx.plugin(SubprocessLocal)
ctx.plugin(GitLocal, { gitCommand: 'git', timeoutMs: 30_000, maxOutputBytes: 8 * 1024 * 1024 })
await new Promise(resolve => setTimeout(resolve, 150))
const started = performance.now()
const status = await ctx.git.status(root)
const elapsed = performance.now() - started
console.log(JSON.stringify({ files: 5000, modified: 200, changes: status.changes.length, milliseconds: Math.round(elapsed) }, null, 2))
if (status.changes.length !== 200) process.exitCode = 1
process.exit(0)
