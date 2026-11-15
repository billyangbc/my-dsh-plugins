/** Provider-level LSP check against the deterministic fake server. */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import LspEditorLocal from '../packages/lsp-editor-local/lib/index.js'

const root = '/tmp/dsh-lsp-check'
rmSync(root, { recursive: true, force: true })
mkdirSync(root, { recursive: true })
writeFileSync(`${root}/a.ts`, 'const undeclared = 1\n')

const markerPath = '/tmp/dsh-lsp-check-child.log'
rmSync(markerPath, { force: true })
process.env.FAKE_LSP_MARKER = markerPath

const ctx = new Context()
ctx.plugin(SubprocessLocal)
ctx.plugin(LspEditorLocal, {
  command: process.execPath,
  args: [new URL('./fake-lsp-server.mjs', import.meta.url).pathname],
  timeoutMs: 8000,
  stderrMaxBytes: 64 * 1024,
  graceMs: 2_000,
  settleMs: 3_000,
})
const service = await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000
  const poll = () => {
    const candidate = ctx.get('lspEditor')
    if (candidate !== undefined) { resolve(candidate); return }
    if (Date.now() > deadline) { reject(new Error('timeout waiting for lspEditor')); return }
    setTimeout(poll, 20)
  }
  poll()
})
const assert = (condition, message) => { if (!condition) throw new Error(`assert: ${message}`) }

const opened = await service.open(root, 'a.ts', 'const undeclared = 1\n', 'typescript')
assert(opened.supported === true, 'the language is served')
assert(opened.settled === true, 'diagnostics settled before the deadline')
assert(opened.diagnostics.length === 1, `one diagnostic (got ${opened.diagnostics.length})`)
assert(opened.diagnostics[0].message === 'unknown identifier', 'diagnostic message')
assert(opened.diagnostics[0].start.character === 6, 'diagnostic position')

const clean = await service.change(opened.id, 'const declared = 1\n')
assert(clean.length === 0, 'diagnostics clear after edit')

const bad = await service.change(opened.id, 'let undeclared = 1\n')
assert(bad.length === 1, 'diagnostic returns after regression')

const hover = await service.hover(opened.id, { line: 0, character: 4 })
assert(hover?.contents === '**fake hover**', 'hover contents')

const definition = await service.definition(opened.id, { line: 0, character: 4 })
assert(definition?.path === '/tmp/dsh-lsp-check/def.ts', 'definition path')
assert(definition?.position.line === 1 && definition.position.character === 2, 'definition position')

const completions = await service.completion(opened.id, { line: 0, character: 4 })
assert(completions.length === 2 && completions[0].label === 'alpha', 'completion items')

await service.close(opened.id)

// Disposal must stop the child process, not just drop the map entry.
await ctx.fiber.dispose()

// An oversized frame must stop the offending server, not the harness process.
const oversizeMarker = '/tmp/dsh-lsp-check-oversize-child.log'
rmSync(oversizeMarker, { force: true })
process.env.FAKE_LSP_MARKER = oversizeMarker
process.env.FAKE_LSP_MODE = 'oversize'
const oversizeCtx = new Context()
oversizeCtx.plugin(SubprocessLocal)
oversizeCtx.plugin(LspEditorLocal, {
  command: process.execPath,
  args: [new URL('./fake-lsp-server.mjs', import.meta.url).pathname],
  timeoutMs: 3000,
  maxMessageBytes: 4096,
  stderrMaxBytes: 64 * 1024,
  graceMs: 500,
  settleMs: 500,
})
const oversizeService = await new Promise((resolve, reject) => {
  const deadline = Date.now() + 5000
  const poll = () => {
    const candidate = oversizeCtx.get('lspEditor')
    if (candidate !== undefined) { resolve(candidate); return }
    if (Date.now() > deadline) { reject(new Error('timeout waiting for lspEditor')); return }
    setTimeout(poll, 20)
  }
  poll()
})
let overflowCode
try {
  await oversizeService.open(root, 'a.ts', 'const x = 1\n', 'typescript')
} catch (error) {
  overflowCode = error?.code ?? error?.message
}
assert(overflowCode === 'lsp/protocol-overflow', `oversize frame reported (got ${String(overflowCode)})`)
const oversizeMarks = existsSync(oversizeMarker) ? readFileSync(oversizeMarker, 'utf8').trim().split('\n') : []
assert(oversizeMarks.includes('exit') || oversizeMarks.includes('SIGTERM'), `oversize server stopped (marks: ${oversizeMarks.join(',')})`)
await oversizeCtx.fiber.dispose()
delete process.env.FAKE_LSP_MODE

const marks = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim().split('\n') : []
assert(marks.includes('start'), 'language server started')
assert(marks.includes('exit') || marks.includes('SIGTERM'), `language server exited on dispose (got ${marks.join(',')})`)

console.log(JSON.stringify({ diagnostics: opened.diagnostics.length, hover: hover?.contents, definition: definition?.path, completions: completions.length, childMarks: marks, overflow: overflowCode, status: 'PASS' }, null, 2))
