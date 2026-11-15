/**
 * Provider-level workspace mutation check: write/create/remove/rename/mkdir, root
 * containment in both link directions, and the payload cap.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import WorkspaceMutationsLocal from '../packages/workspace-mutations-local/lib/index.js'

const root = '/tmp/dsh-mutations-check'
rmSync(root, { recursive: true, force: true })
mkdirSync(join(root, 'src'), { recursive: true })
mkdirSync('/tmp/dsh-mutations-outside', { recursive: true })
writeFileSync('/tmp/dsh-mutations-outside/secret.txt', 'ORIGINAL')

const ctx = new Context()
ctx.plugin(WorkspaceMutationsLocal, { maxWriteBytes: 1024 })
const service = await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000
  const poll = () => {
    const candidate = ctx.get('workspaceMutations')
    if (candidate !== undefined) { resolve(candidate); return }
    if (Date.now() > deadline) { reject(new Error('timeout waiting for workspaceMutations')); return }
    setTimeout(poll, 20)
  }
  poll()
})
const assert = (condition, message) => { if (!condition) throw new Error(`assert: ${message}`) }
const rejects = async (operation, label) => {
  try {
    await operation()
  } catch {
    return
  }
  throw new Error(`assert: ${label} should have been rejected`)
}

const written = await service.write(root, 'src/a.txt', 'one\ntwo\n')
assert(written.bytes === 8, `byte count (got ${String(written.bytes)})`)
assert(readFileSync(join(root, 'src', 'a.txt'), 'utf8') === 'one\ntwo\n', 'content written')

await rejects(() => service.write(root, 'src/a.txt', 'x', 'deadbeef'), 'hash conflict')
await service.write(root, 'src/a.txt', 'one\ntwo\n', written.hash)

// create() never truncates an existing entry
const created = await service.create(root, 'src/new.txt', 'fresh\n')
assert(readFileSync(join(root, 'src', 'new.txt'), 'utf8') === 'fresh\n', 'create wrote content')
await rejects(() => service.create(root, 'src/new.txt', 'clobber'), 'create refuses an existing path')
assert(readFileSync(join(root, 'src', 'new.txt'), 'utf8') === 'fresh\n', 'existing content survives a refused create')
assert(created.bytes === 6, `create byte count (got ${String(created.bytes)})`)

await service.mkdir(root, 'src/nested')
await service.rename(root, 'src/nested', 'src/moved')
await service.remove(root, 'src/moved')
assert(existsSync(join(root, 'src', 'moved')) === false, 'directory removed')

// containment: absolute, parent escape, and a symlinked directory all stay refused
await rejects(() => service.write(root, '../outside.txt', 'x'), 'parent escape')
await rejects(() => service.write(root, '/etc/passwd', 'x'), 'absolute path')
symlinkSync('/tmp/dsh-mutations-outside', join(root, 'escape'))
await rejects(() => service.write(root, 'escape/evil.txt', 'x'), 'symlinked directory escape')
assert(existsSync('/tmp/dsh-mutations-outside/evil.txt') === false, 'no file created outside the root')

// containment: a symlinked FILE is refused for writes and removed as an entry, never followed
symlinkSync('/tmp/dsh-mutations-outside/secret.txt', join(root, 'link.txt'))
await rejects(() => service.write(root, 'link.txt', 'PWNED'), 'write through a symlinked file')
await rejects(() => service.create(root, 'link.txt', 'PWNED'), 'create through a symlinked file')
assert(readFileSync('/tmp/dsh-mutations-outside/secret.txt', 'utf8') === 'ORIGINAL', 'linked target untouched by writes')

await service.remove(root, 'link.txt')
assert(existsSync(join(root, 'link.txt')) === false, 'link removed as an entry')
assert(readFileSync('/tmp/dsh-mutations-outside/secret.txt', 'utf8') === 'ORIGINAL', 'link target survives remove')

// payload cap
await rejects(() => service.write(root, 'src/big.txt', 'x'.repeat(2048)), 'payload cap')

await ctx.fiber.dispose()
console.log(JSON.stringify({ bytes: written.bytes, status: 'PASS' }, null, 2))
