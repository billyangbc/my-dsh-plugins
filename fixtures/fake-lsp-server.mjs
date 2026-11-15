/** Minimal stdio LSP server for provider tests: reports `undeclared` identifiers and a hover. */
import { appendFileSync } from 'node:fs'

// Termination is observable: the provider check asserts the child really exits on dispose.
const marker = process.env.FAKE_LSP_MARKER
const mark = label => { if (marker !== undefined) appendFileSync(marker, `${label}\n`) }
mark('start')
process.on('exit', () => { mark('exit') })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { mark(signal); process.exit(0) })

let buffer = Buffer.alloc(0)
process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n')
    if (end < 0) return
    const header = buffer.subarray(0, end).toString('ascii')
    const length = Number.parseInt(/Content-Length:\s*(\d+)/iu.exec(header)?.[1] ?? '0', 10)
    if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString('utf8'))
    buffer = buffer.subarray(end + 4 + length)
    handle(message)
  }
})

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`)
  process.stdout.write(body)
}

function publish(uri, text) {
  const index = text.indexOf('undeclared')
  const diagnostics = index < 0 ? [] : [{
    range: { start: { line: 0, character: index }, end: { line: 0, character: index + 10 } },
    severity: 1,
    source: 'fake',
    message: 'unknown identifier',
  }]
  send({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri, diagnostics } })
}

function handle(message) {
  // Oversize mode announces a frame above the provider's cap and never answers.
  if (process.env.FAKE_LSP_MODE === 'oversize' && message.method === 'initialize') {
    process.stdout.write('Content-Length: 9000000\r\n\r\n')
    return
  }
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { textDocumentSync: 1, hoverProvider: true } } })
    return
  }
  if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: null })
    return
  }
  if (message.method === 'exit') {
    process.exit(0)
  }
  if (message.method === 'textDocument/didOpen') {
    publish(message.params.textDocument.uri, message.params.textDocument.text)
    return
  }
  if (message.method === 'textDocument/didChange') {
    publish(message.params.textDocument.uri, message.params.contentChanges[0].text)
    return
  }
  if (message.method === 'textDocument/definition') {
    send({ jsonrpc: '2.0', id: message.id, result: { uri: 'file:///tmp/dsh-lsp-check/def.ts', range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } } })
    return
  }
  if (message.method === 'textDocument/completion') {
    send({ jsonrpc: '2.0', id: message.id, result: { isIncomplete: false, items: [{ label: 'alpha', detail: 'function alpha()', kind: 3 }, { label: 'beta', kind: 6 }] } })
    return
  }
  if (message.method === 'textDocument/hover') {
    send({ jsonrpc: '2.0', id: message.id, result: { contents: { kind: 'markdown', value: '**fake hover**' } } })
  }
}
