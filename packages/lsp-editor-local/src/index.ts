/**
 * stdio LSP provider: one JSON-RPC server process per workspace root.
 * @module @zifyai/dsh-lsp-editor-local
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAbsolute, join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-subprocess'
import { LspEditor, LspError } from '@zifyai/dsh-lsp-editor'
import type { LspCompletionItem, LspDiagnostic, LspHover, LspLocation, LspOpenResult, LspPosition } from '@zifyai/dsh-lsp-editor'

/** Provider configuration. */
export interface Config {
  /** Language server executable. */
  command: string
  /** Fixed arguments passed before protocol traffic. */
  args?: string[]
  /** Request timeout in milliseconds. */
  timeoutMs?: number
  /** Maximum accepted message body in bytes. */
  maxMessageBytes?: number
  /** Maximum retained stderr per server in bytes. */
  stderrMaxBytes?: number
  /** Grace period between `terminate()` and forced kill, in milliseconds. */
  graceMs?: number
  /** Longest wait for diagnostics to settle after an open or change, in milliseconds. */
  settleMs?: number
  /** Language ids this server handles; omitted means every id. */
  languageIds?: string[]
}

/** Cordis schema for {@link Config}. */
export const Config: z<Config> = z.object({
  command: z.string().required().description('Language server executable.'),
  args: z.array(z.string()).default([]).description('Fixed arguments passed before protocol traffic.'),
  timeoutMs: z.natural().min(500).max(120_000).default(10_000).description('Request timeout in milliseconds.'),
  maxMessageBytes: z.natural().min(1024).max(64 * 1024 * 1024).default(8 * 1024 * 1024).description('Maximum accepted message body in bytes.'),
  stderrMaxBytes: z.natural().min(1024).max(1024 * 1024).default(64 * 1024).description('Maximum retained stderr per server in bytes.'),
  graceMs: z.natural().min(1).default(2_000).description('Grace period between terminate() and forced kill.'),
  settleMs: z.natural().min(1).default(2_000).description('Longest wait for diagnostics to settle after an open or change.'),
  languageIds: z.array(z.string()).default([]).description('Language ids this server handles; empty means every id.'),
})

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface Document {
  readonly uri: string
  version: number
  readonly listeners: Set<() => void>
}

interface Server {
  readonly root: string
  readonly process: ReturnType<Context['subprocess']['spawn']>
  readonly stdin: Writable
  readonly stdout: Readable
  readonly pending: Map<number, Pending>
  readonly documents: Map<string, Document>
  readonly diagnostics: Map<string, LspDiagnostic[]>
  nextId: number
  buffer: Buffer
  ready: Promise<void>
  /** Set once the server can no longer serve requests. */
  failure: Error | undefined
}

/** Map an LSP severity number into the protocol's enum. */
function severityOf(value: unknown): number {
  return typeof value === 'number' && value >= 1 && value <= 4 ? value : 1
}

/** Convert one LSP diagnostic. */
function toDiagnostic(raw: Record<string, unknown>): LspDiagnostic {
  const range = raw['range'] as { start?: LspPosition; end?: LspPosition } | undefined
  return {
    severity: severityOf(raw['severity']),
    message: typeof raw['message'] === 'string' ? raw['message'] : '',
    start: range?.start ?? { line: 0, character: 0 },
    end: range?.end ?? range?.start ?? { line: 0, character: 0 },
    ...(typeof raw['source'] === 'string' ? { source: raw['source'] } : {}),
  }
}

/** Flatten LSP hover contents into text. */
function hoverText(contents: unknown): string {
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(item => hoverText(item)).filter(text => text !== '').join('\n\n')
  if (contents !== null && typeof contents === 'object') {
    const record = contents as Record<string, unknown>
    if (typeof record['value'] === 'string') return record['value']
  }
  return ''
}

/** Local stdio language servers. */
export default class LspEditorLocal extends LspEditor {
  static inject = ['subprocess']

  static Config: z<Config> = Config

  /**
   * @param ctx - Host context with subprocess access.
   * @param config - executable, deadlines, and message caps.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
    // Awaiting the disposer keeps fiber disposal blocked until every server has exited.
    ctx.effect(() => () => this.stopAll(), 'lsp-editor: stop language servers')
  }

  async open(root: string, path: string, text: string, languageId: string): Promise<LspOpenResult> {
    const handled = this.config.languageIds ?? []
    if (handled.length > 0 && !handled.includes(languageId)) {
      return { id: '', diagnostics: [], supported: false, settled: false }
    }
    const server = await this.server(root)
    await server.ready
    const absolute = isAbsolute(path) ? path : join(root, path)
    const uri = pathToFileURL(absolute).href
    const id = `${root}\u0000${uri}`
    const existing = server.documents.get(uri)
    if (existing !== undefined) {
      existing.version += 1
      this.notify(server, 'textDocument/didChange', {
        textDocument: { uri, version: existing.version },
        contentChanges: [{ text }],
      })
      const settled = await this.settle(server, uri)
      return { id, diagnostics: server.diagnostics.get(uri) ?? [], supported: true, settled }
    }
    const document: Document = { uri, version: 1, listeners: new Set() }
    server.documents.set(uri, document)
    server.diagnostics.set(uri, [])
    this.notify(server, 'textDocument/didOpen', {
      textDocument: { uri, languageId, version: document.version, text },
    })
    const settled = await this.settle(server, uri)
    return { id, diagnostics: server.diagnostics.get(uri) ?? [], supported: true, settled }
  }

  async change(id: string, text: string): Promise<readonly LspDiagnostic[]> {
    const { server, uri } = this.locate(id)
    const document = server.documents.get(uri)
    if (document === undefined) throw new LspError(`document is not open: ${uri}`, 'lsp/not-open', id)
    document.version += 1
    this.notify(server, 'textDocument/didChange', {
      textDocument: { uri, version: document.version },
      contentChanges: [{ text }],
    })
    await this.settle(server, uri)
    return await this.diagnostics(id)
  }

  async close(id: string): Promise<void> {
    const { server, uri } = this.locate(id)
    server.documents.delete(uri)
    server.diagnostics.delete(uri)
    this.notify(server, 'textDocument/didClose', { textDocument: { uri } })
    if (server.documents.size === 0) await this.stop(server)
  }

  async diagnostics(id: string): Promise<readonly LspDiagnostic[]> {
    const { server, uri } = this.locate(id)
    return server.diagnostics.get(uri) ?? []
  }

  async definition(id: string, position: LspPosition): Promise<LspLocation | undefined> {
    const { server, uri } = this.locate(id)
    const result = await this.request(server, 'textDocument/definition', { textDocument: { uri }, position }) as
      { uri?: string; range?: { start: LspPosition } } | { uri?: string; range?: { start: LspPosition } }[] | null
    const first = Array.isArray(result) ? result[0] : result
    if (first?.uri === undefined) return undefined
    const path = fileURLToPath(first.uri)
    return { path, position: first.range?.start ?? { line: 0, character: 0 } }
  }

  async completion(id: string, position: LspPosition): Promise<readonly LspCompletionItem[]> {
    const { server, uri } = this.locate(id)
    const result = await this.request(server, 'textDocument/completion', { textDocument: { uri }, position })
    const items: readonly Record<string, unknown>[] = Array.isArray(result)
      ? result as readonly Record<string, unknown>[]
      : (result as { items?: readonly Record<string, unknown>[] } | null)?.items ?? []
    return items.map(item => ({
      label: typeof item['label'] === 'string' ? item['label'] : '',
      ...(typeof item['detail'] === 'string' ? { detail: item['detail'] } : {}),
      ...(typeof item['kind'] === 'number' ? { kind: String(item['kind']) } : {}),
    })).filter(item => item.label !== '')
  }

  async hover(id: string, position: LspPosition): Promise<LspHover | undefined> {
    const { server, uri } = this.locate(id)
    const result = await this.request(server, 'textDocument/hover', { textDocument: { uri }, position }) as
      { contents?: unknown; range?: { start: LspPosition; end: LspPosition } } | null
    if (result === null || result.contents === undefined) return undefined
    const text = hoverText(result.contents)
    if (text === '') return undefined
    return { contents: text, ...(result.range === undefined ? {} : { range: result.range }) }
  }

  private locate(id: string): { server: Server; uri: string } {
    const separator = id.indexOf('\u0000')
    if (separator < 0) throw new LspError(`invalid document handle: ${id}`, 'lsp/unknown-document', id)
    const root = id.slice(0, separator)
    const uri = id.slice(separator + 1)
    const server = this.servers.get(root)
    if (server === undefined) throw new LspError(`no language server for ${root}`, 'lsp/stopped', id)
    if (server.failure !== undefined) throw server.failure
    return { server, uri }
  }

  private readonly servers = new Map<string, Server>()

  private async server(root: string): Promise<Server> {
    const existing = this.servers.get(root)
    if (existing !== undefined) return existing
    const process = this.ctx.subprocess.spawn({
      argv: [this.config.command, ...(this.config.args ?? [])],
      cwd: root,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: this.config.stderrMaxBytes ?? 64 * 1024 } },
      graceMs: this.config.graceMs ?? 2_000,
    })
    const { stdin, stdout } = process
    if (stdin === undefined || stdout === undefined) {
      process.terminate()
      throw new LspError('language server needs piped stdio', 'lsp/failed', root)
    }
    const server: Server = {
      root,
      process,
      stdin,
      stdout,
      pending: new Map(),
      documents: new Map(),
      diagnostics: new Map(),
      nextId: 1,
      buffer: Buffer.alloc(0),
      ready: Promise.resolve(),
      failure: undefined,
    }
    // A frame handler must never throw: an exception here would leave the harness, not the server, dead.
    stdout.on('data', (chunk: Buffer) => { this.receive(server, chunk) })
    // Delete only this generation, so a replacement spawned later is not evicted by a stale exit.
    process.done.then(
      () => { this.forget(server) },
      () => { this.forget(server) },
    )
    this.servers.set(root, server)
    server.ready = this.request(server, 'initialize', {
      processId: null,
      rootUri: pathToFileURL(root).href,
      capabilities: {
        textDocument: {
          publishDiagnostics: {},
          hover: { contentFormat: ['markdown', 'plaintext'] },
        },
      },
    }).then(() => { this.notify(server, 'initialized', {}) }).then(() => undefined).catch((error: unknown) => {
      const failure = error instanceof LspError ? error : new LspError(`language server initialize failed: ${String(error)}`, 'lsp/failed', root)
      this.fail(server, failure)
      throw failure
    })
    return server
  }

  /** Drop a server that exited, unless the map already moved on to its replacement. */
  private forget(server: Server): void {
    if (this.servers.get(server.root) === server) this.servers.delete(server.root)
    if (server.failure === undefined) server.failure = new LspError(`language server exited: ${server.root}`, 'lsp/stopped', server.root)
    for (const pending of server.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(server.failure)
    }
    server.pending.clear()
  }

  /** Mark a server unusable, reject its work, and stop the process. */
  private fail(server: Server, failure: Error): void {
    if (server.failure !== undefined) return
    server.failure = failure
    if (this.servers.get(server.root) === server) this.servers.delete(server.root)
    for (const pending of server.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(failure)
    }
    server.pending.clear()
    server.documents.clear()
    server.diagnostics.clear()
    server.stdout.destroy()
    server.process.terminate()
  }

  private receive(server: Server, chunk: Buffer): void {
    if (server.failure !== undefined) return
    server.buffer = Buffer.concat([server.buffer, chunk])
    try {
      this.drain(server)
    } catch (error: unknown) {
      this.fail(server, error instanceof LspError
        ? error
        : new LspError(`language server frame failed: ${String(error)}`, 'lsp/failed', server.root))
    }
  }

  /** Consume every complete frame in the buffer; oversized frames fail the server instead of the host. */
  private drain(server: Server): void {
    for (;;) {
      const headerEnd = server.buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = server.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/iu.exec(header)
      if (match === null) {
        server.buffer = server.buffer.subarray(headerEnd + 4)
        continue
      }
      const length = Number.parseInt(match[1] ?? '0', 10)
      const maxMessageBytes = this.config.maxMessageBytes ?? 8 * 1024 * 1024
      if (length > maxMessageBytes) {
        throw new LspError(
          `language server message exceeds ${String(maxMessageBytes)} bytes`,
          'lsp/protocol-overflow',
          server.root,
        )
      }
      if (server.buffer.length < headerEnd + 4 + length) return
      const body = server.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')
      server.buffer = server.buffer.subarray(headerEnd + 4 + length)
      let message: Record<string, unknown>
      try {
        message = JSON.parse(body) as Record<string, unknown>
      } catch {
        // A malformed frame is the server's error, not a frame the parser can trust; drop it and continue.
        continue
      }
      this.dispatch(server, message)
    }
  }

  private dispatch(server: Server, message: Record<string, unknown>): void {
    if (typeof message['id'] === 'number' && (message['result'] !== undefined || message['error'] !== undefined)) {
      const pending = server.pending.get(message['id'])
      if (pending === undefined) return
      server.pending.delete(message['id'])
      clearTimeout(pending.timer)
      if (message['error'] !== undefined) pending.reject(new LspError(JSON.stringify(message['error']), 'lsp/failed', server.root))
      else pending.resolve(message['result'])
      return
    }
    if (message['method'] === 'textDocument/publishDiagnostics') {
      const params = message['params'] as { uri?: string; diagnostics?: unknown[] } | undefined
      const uri = params?.uri
      if (typeof uri !== 'string') return
      const diagnostics = (params?.diagnostics ?? []).map(raw => toDiagnostic(raw as Record<string, unknown>))
      server.diagnostics.set(uri, diagnostics)
      const document = server.documents.get(uri)
      if (document !== undefined) for (const listener of document.listeners) listener()
    }
  }

  private send(server: Server, message: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    server.stdin.write(`Content-Length: ${String(body.length)}\r\n\r\n`)
    server.stdin.write(body)
  }

  private notify(server: Server, method: string, params: unknown): void {
    this.send(server, { jsonrpc: '2.0', method, params })
  }

  private request(server: Server, method: string, params: unknown): Promise<unknown> {
    const id = server.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        server.pending.delete(id)
        reject(new LspError(`language server request timed out: ${method}`, 'lsp/timeout', method))
      }, this.config.timeoutMs ?? 10_000)
      server.pending.set(id, { resolve, reject, timer })
      this.send(server, { jsonrpc: '2.0', id, method, params })
    })
  }

  /**
   * Wait for the next diagnostics publication, or for the settle deadline.
   * @param server - server that owns the document.
   * @param uri - document uri.
   * @returns true when a publication arrived, false when the deadline expired first.
   */
  private async settle(server: Server, uri: string): Promise<boolean> {
    const document = server.documents.get(uri)
    if (document === undefined) return false
    const { listeners } = document
    return await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { done(false) }, this.config.settleMs ?? 2_000)
      const done = (settled: boolean): void => {
        listeners.delete(listener)
        clearTimeout(timer)
        resolve(settled)
      }
      function listener(): void { done(true) }
      listeners.add(listener)
    })
  }

  private async stop(server: Server): Promise<void> {
    if (this.servers.get(server.root) === server) this.servers.delete(server.root)
    for (const pending of server.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new LspError('language server stopped', 'lsp/stopped', server.root))
    }
    server.pending.clear()
    try {
      await this.request(server, 'shutdown', null)
    } catch {
      // The server may already be gone; termination below covers every remaining case.
    }
    try {
      this.notify(server, 'exit', null)
    } catch {
      // stdin may already be closed by a server that exited on shutdown.
    }
    server.process.terminate()
    await server.process.done.catch(() => undefined)
    await server.process.waitForExit().catch(() => false)
  }

  private async stopAll(): Promise<void> {
    await Promise.allSettled([...this.servers.values()].map(server => this.stop(server)))
  }
}
