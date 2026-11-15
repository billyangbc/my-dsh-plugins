/**
 * Create a deterministic Session log for UI fixtures: one user prompt and one
 * assistant reply containing a Mermaid fence plus a short paragraph.
 *
 * Usage: DSH_HOME=/tmp/home node fixtures/make-session.mjs <workspace-cwd> [heading]
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, realpathSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import Session from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'

const cwd = process.argv[2] === undefined ? undefined : realpathSync(process.argv[2])
const heading = process.argv[3] ?? 'P4 fixture'
const home = process.env.DSH_HOME
if (!cwd || !home) throw new Error('usage: DSH_HOME=<home> node fixtures/make-session.mjs <workspace-cwd>')

const root = `${home}/sessions`
mkdirSync(root, { recursive: true })
const ctx = new Context()
ctx.plugin(Session)
ctx.plugin(SessionPersistenceJsonl, { root, compression: 'zstd' })
await new Promise(resolve => setTimeout(resolve, 200))

const id = randomUUID()
const now = Date.now()
const text = [
  `## ${heading}`,
  '',
  '下面是一个 Mermaid 流程图：',
  '',
  '```mermaid',
  'graph TD;A[Start]-->B[End]',
  '```',
  '',
  '以上是 fixture 内容。',
].join('\n')

const events = [
  { type: 'turn/start', seq: 0, time: now, data: { turn: 1 } },
  { type: 'step/start', seq: 1, time: now + 1, data: { turn: 1, step: 1 } },
  { type: 'user/message', seq: 2, time: now + 2, surfaceOp: 'append', data: {
    role: 'user',
    id: randomUUID(),
    source: { kind: 'user' },
    content: [{ type: 'text', text: '请展示一个 Mermaid 图。' }],
  } },
  {
    type: 'assistant/message',
    seq: 3,
    surfaceOp: 'append',
    time: now + 3,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        id: randomUUID(),
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stream: [],
    },
  },
  { type: 'step/end', seq: 4, time: now + 4, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 5, time: now + 5, data: { turn: 1, reason: 'completed' } },
]

const handle = await ctx.sessionPersistence.create({
  version: 4,
  id,
  createdAt: now,
  cwd,
  isSeeded: false,
})
await handle.append(events)
await handle.flush()
await handle.close()
console.log(JSON.stringify({ id, cwd, root, events: events.length }))
process.exit(0)
