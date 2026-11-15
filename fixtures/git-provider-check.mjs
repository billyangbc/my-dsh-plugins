/**
 * Provider-level Git check: mount subprocess-local + git-local and exercise
 * status/diff/stage/unstage/commit/log plus hunk operations and push.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import GitLocal from '../packages/git-local/lib/index.js'

const root = '/tmp/dsh-git-provider-check'
const remote = '/tmp/dsh-git-provider-remote.git'
rmSync(root, { recursive: true, force: true })
rmSync(remote, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.email', 'test@example.com'])
git(['config', 'user.name', 'Test'])
const base = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`)
writeFileSync(join(root, 'multi.txt'), `${base.join('\n')}\n`)
git(['add', 'multi.txt'])
git(['commit', '-q', '-m', 'initial'])

const modified = [...base]
modified[1] = 'line 2 changed'
modified[17] = 'line 18 changed'
writeFileSync(join(root, 'multi.txt'), `${modified.join('\n')}\n`)
writeFileSync(join(root, 'b.txt'), 'new\n')
writeFileSync(join(root, 'a b.txt'), 'spaced\n')

const ctx = new Context()
ctx.plugin(SubprocessLocal)
ctx.plugin(GitLocal, {
  gitCommand: 'git',
  timeoutMs: 15_000,
  maxOutputBytes: 4 * 1024 * 1024,
  graceMs: 2_000,
  logLimit: 200,
  graphLimit: 500,
})
const service = await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000
  const poll = () => {
    const candidate = ctx.get('git')
    if (candidate !== undefined) { resolve(candidate); return }
    if (Date.now() > deadline) { reject(new Error('timeout waiting for git')); return }
    setTimeout(poll, 20)
  }
  poll()
})
const assert = (condition, message) => { if (!condition) throw new Error(`assert: ${message}`) }
const headersOf = diff => diff.split('\n').filter(line => line.startsWith('@@ '))

const initial = await service.status(root)
assert(initial.repository === true, 'repository detected')
assert(initial.branch === 'main', `branch main (got ${String(initial.branch)})`)
assert(initial.changes.some(change => change.path === 'multi.txt' && !change.staged), 'modified file unstaged')
assert(initial.changes.some(change => change.path === 'b.txt' && change.status === '?'), 'untracked file listed')
assert(initial.changes.some(change => change.path === 'a b.txt'), 'path with a space parsed verbatim')
const unstagedHeaders = headersOf(await service.diff(root, 'multi.txt', false))
assert(unstagedHeaders.length === 2, `two hunks (got ${unstagedHeaders.length})`)

// hunk stage: only the first hunk enters the index
await service.stageHunks(root, 'multi.txt', [unstagedHeaders[0]])
let status = await service.status(root)
assert(status.changes.some(change => change.path === 'multi.txt' && change.staged), 'file partially staged')
const cachedDiff = await service.diff(root, 'multi.txt', true)
assert(cachedDiff.includes('line 2 changed') && !cachedDiff.includes('line 18 changed'), 'index holds only the first hunk')
const remaining = headersOf(await service.diff(root, 'multi.txt', false))
assert(remaining.length === 1, `one unstaged hunk remains (got ${remaining.length})`)

// hunk unstage: index returns to empty for the first hunk
await service.unstageHunks(root, 'multi.txt', headersOf(cachedDiff))
status = await service.status(root)
assert(status.changes.every(change => !(change.path === 'multi.txt' && change.staged)), 'multi.txt unstaged again')

// hunk discard: second hunk leaves the work tree, first stays modified
const beforeDiscard = headersOf(await service.diff(root, 'multi.txt', false))
await service.discardHunks(root, 'multi.txt', [beforeDiscard[1]])
const content = readFileSync(join(root, 'multi.txt'), 'utf8')
assert(content.includes('line 2 changed') && !content.includes('line 18 changed'), 'second hunk discarded only')

// commit + log
await service.stage(root, ['multi.txt'])
const committed = await service.commit(root, 'second commit')
assert(/^[0-9a-f]{7,40}$/.test(committed.hash), 'commit hash returned')
assert(committed.status.changes.some(change => change.path === 'b.txt' && !change.staged), 'untracked file remains')
const graph = await service.graph(root, 10)
assert(graph.includes('*') && graph.includes('second commit'), 'ascii graph rendered')

const log = await service.log(root, 5)
assert(log.length === 2, `two commits in log (got ${log.length})`)
assert(log[0].subject === 'second commit', 'newest commit first')
assert(Array.isArray(log[0].parents), 'commit parents present')
const detail = await service.commitDetail(root, log[0].hash)
assert(detail.patch.includes('diff --git') && detail.patch.includes('line 2 changed'), 'commit patch covers the changed file')
assert(detail.commit.hash === log[0].hash, 'commit detail hash matches')

// push to a local bare remote
git(['init', '-q', '--bare', remote], '/tmp')
git(['remote', 'add', 'origin', remote])
const firstPush = await service.push(root)
assert(firstPush.pushed === true, 'first push published commits')
assert(firstPush.status.ahead === 0, `ahead resets after push (got ${String(firstPush.status.ahead)})`)
git(['commit', '-q', '-m', 'local only commit', '--allow-empty'])
const aheadStatus = await service.status(root)
assert(aheadStatus.ahead === 1, `one commit ahead (got ${String(aheadStatus.ahead)})`)
const secondPush = await service.push(root)
assert(secondPush.pushed === true, 'second push published the new commit')
assert(secondPush.status.ahead === 0, 'ahead resets again')

// multi-remote: an explicit remote name publishes there without changing upstream.
const backup = '/tmp/dsh-git-provider-backup.git'
rmSync(backup, { recursive: true, force: true })
git(['init', '-q', '--bare', backup], '/tmp')
git(['remote', 'add', 'backup', backup])
const withRemotes = await service.status(root)
assert(withRemotes.remotes?.includes('origin') === true && withRemotes.remotes?.includes('backup') === true, 'remote names listed')
const backupPush = await service.push(root, 'backup')
assert(backupPush.pushed === true, 'explicit remote push published')
let unknownRejected = false
try { await service.push(root, 'missing') } catch { unknownRejected = true }
assert(unknownRejected, 'unknown remote rejected')

// A command that never returns must be terminated at its deadline, not left running.
const slowGit = '/tmp/dsh-slow-git.sh'
const slowLog = '/tmp/dsh-slow-git.log'
writeFileSync(slowGit, '#!/bin/sh\necho start >> ' + slowLog + '\ntrap "echo term >> ' + slowLog + '; exit 0" TERM\nsleep 30\n', { mode: 0o755 })
rmSync(slowLog, { force: true })
const slowCtx = new Context()
slowCtx.plugin(SubprocessLocal)
slowCtx.plugin(GitLocal, {
  gitCommand: slowGit,
  timeoutMs: 300,
  maxOutputBytes: 4096,
  graceMs: 500,
  logLimit: 10,
  graphLimit: 10,
})
const slowService = await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000
  const poll = () => {
    const candidate = slowCtx.get('git')
    if (candidate !== undefined) { resolve(candidate); return }
    if (Date.now() > deadline) { reject(new Error('timeout waiting for git')); return }
    setTimeout(poll, 20)
  }
  poll()
})
let deadlineError
try {
  await slowService.status(root)
} catch (error) {
  deadlineError = error
}
assert(deadlineError?.code === 'git/timeout', `deadline reported (got ${String(deadlineError?.code)})`)
await new Promise(resolve => setTimeout(resolve, 800))
const slowMarks = existsSync(slowLog) ? readFileSync(slowLog, 'utf8') : ''
assert(slowMarks.includes('start'), 'slow git started')
assert(slowMarks.includes('term'), `slow git terminated on timeout (marks: ${slowMarks.trim()})`)
await slowCtx.fiber.dispose()

await ctx.fiber.dispose()
console.log(JSON.stringify({
  branch: initial.branch,
  graph: graph.split('\n')[0],
  hunks: unstagedHeaders.length,
  commits: log.map(row => row.subject),
  pushed: [firstPush.pushed, secondPush.pushed],
  timeoutMarks: slowMarks.trim().split('\n'),
  status: 'PASS',
}, null, 2))
