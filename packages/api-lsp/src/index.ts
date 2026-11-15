/**
 * Editor LSP Remote: open documents and read diagnostics and hover for the calling Session's workspace.
 * @module @zifyai/dsh-api-lsp
 */

import { isAbsolute, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { LspError } from '@zifyai/dsh-lsp-editor'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LspCompletionItem, LspDiagnostic, LspDefinitionTarget, LspHover, LspOpenResult, LspPosition } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Session has no workspace directory. */
    'lsp/no-workspace': { readonly sessionId: string }
    /** The calling principal is not allowed to read this Session's workspace. */
    'lsp/forbidden': { readonly sessionId: string }
    /** The document handle is unknown or belongs to another Session. */
    'lsp/unknown-document': { readonly reason: string }
    /** The document is not open in a language server. */
    'lsp/not-open': { readonly reason: string }
    /** No language server serves this document. */
    'lsp/stopped': { readonly reason: string }
    /** A language server request exceeded its deadline. */
    'lsp/timeout': { readonly reason: string }
    /** The server produced a frame above the configured cap; the server was stopped. */
    'lsp/protocol-overflow': { readonly reason: string }
    /** The language server failed for any other reason. */
    'lsp/failed': { readonly reason: string }
  }
}

/** LSP operations bound to the calling Session's workspace. */
export default class LspController extends TypertRemoteService {
  static inject = ['lspEditor', 'sessions', 'remoteAccess']

  /**
   * @param ctx - Host context with the LSP capability, Session store, and access policy.
   */
  constructor(ctx: Context) {
    super(ctx, 'lspController', { namespace: 'lsp' })
  }

  /**
   * Open a document in the Session workspace.
   * @param sessionId - calling Session identity.
   * @param path - workspace-relative path.
   * @param text - current content.
   * @param languageId - LSP language id.
   * @param signal - caller cancellation.
   * @returns handle, current diagnostics, and whether a server answered.
   */
  @Remote('open')
  async openForClient(sessionId: SessionId, path: string, text: string, languageId: string, signal: AbortSignal): Promise<LspOpenResult> {
    signal.throwIfAborted()
    const root = this.root(sessionId)
    const opened = await this.fail(() => this.ctx.lspEditor.open(root, path, text, languageId))
    return opened.id === '' ? opened : { ...opened, id: `${sessionId}\u0000${opened.id}` }
  }

  /**
   * Replace a document's content.
   * @param sessionId - calling Session identity.
   * @param id - handle from {@link openForClient}.
   * @param text - new full content.
   * @param signal - caller cancellation.
   * @returns current diagnostics.
   */
  @Remote('change')
  async changeForClient(sessionId: SessionId, id: string, text: string, signal: AbortSignal): Promise<readonly LspDiagnostic[]> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.lspEditor.change(this.unwrap(sessionId, id), text))
  }

  /**
   * Close a document.
   * @param sessionId - calling Session identity.
   * @param id - handle.
   * @param signal - caller cancellation.
   */
  @Remote('close')
  async closeForClient(sessionId: SessionId, id: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.fail(() => this.ctx.lspEditor.close(this.unwrap(sessionId, id)))
  }

  /**
   * Read the latest diagnostics.
   * @param sessionId - calling Session identity.
   * @param id - handle.
   * @param signal - caller cancellation.
   * @returns current diagnostics.
   */
  @Remote('diagnostics')
  async diagnosticsForClient(sessionId: SessionId, id: string, signal: AbortSignal): Promise<readonly LspDiagnostic[]> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.lspEditor.diagnostics(this.unwrap(sessionId, id)))
  }

  /**
   * Resolve the definition at a position.
   * @param sessionId - calling Session identity.
   * @param id - handle.
   * @param position - zero-based position.
   * @param signal - caller cancellation.
   * @returns the target location, or undefined.
   */
  @Remote('definition')
  async definitionForClient(sessionId: SessionId, id: string, position: LspPosition, signal: AbortSignal): Promise<LspDefinitionTarget | undefined> {
    signal.throwIfAborted()
    const root = this.root(sessionId)
    const located = await this.fail(() => this.ctx.lspEditor.definition(this.unwrap(sessionId, id), position))
    if (located === undefined) return undefined
    return { path: this.workspacePath(root, located.path), position: located.position }
  }

  /**
   * List completions at a position.
   * @param sessionId - calling Session identity.
   * @param id - handle.
   * @param position - zero-based position.
   * @param signal - caller cancellation.
   * @returns completion items.
   */
  @Remote('completion')
  async completionForClient(sessionId: SessionId, id: string, position: LspPosition, signal: AbortSignal): Promise<readonly LspCompletionItem[]> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.lspEditor.completion(this.unwrap(sessionId, id), position))
  }

  /**
   * Ask for hover contents.
   * @param sessionId - calling Session identity.
   * @param id - handle.
   * @param position - zero-based position.
   * @param signal - caller cancellation.
   * @returns hover contents, or undefined.
   */
  @Remote('hover')
  async hoverForClient(sessionId: SessionId, id: string, position: LspPosition, signal: AbortSignal): Promise<LspHover | undefined> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.lspEditor.hover(this.unwrap(sessionId, id), position))
  }

  /**
   * Convert one absolute path below the workspace root into a workspace-relative path.
   * @param root - absolute workspace root.
   * @param path - absolute path reported by the server.
   * @returns the workspace-relative path, or the original path when it lies outside the workspace.
   */
  private workspacePath(root: string, path: string): string {
    const relativePath = relative(root, path)
    if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      return path
    }
    return sep === '/' ? relativePath : relativePath.split(sep).join('/')
  }

  /**
   * Resolve the calling Session's workspace root after checking access.
   * @param sessionId - calling Session identity.
   * @returns the absolute workspace root.
   */
  private root(sessionId: SessionId): string {
    if (!this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
      throw new RemoteError('lsp/forbidden', `not allowed to read session ${sessionId}`, { sessionId })
    }
    const cwd = this.ctx.sessions.get(sessionId)?.header.cwd
    if (cwd === undefined) throw new RemoteError('lsp/no-workspace', `session ${sessionId} has no workspace`, { sessionId })
    return cwd
  }

  private unwrap(sessionId: SessionId, id: string): string {
    const prefix = `${sessionId}\u0000`
    if (!id.startsWith(prefix)) {
      throw new RemoteError('lsp/unknown-document', 'document is not owned by this session', { reason: id })
    }
    return id.slice(prefix.length)
  }

  /**
   * Run one operation, mapping the capability's typed failures onto Remote codes.
   * @param operation - the operation to await.
   * @returns the operation result.
   */
  private async fail<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      if (error instanceof LspError) {
        throw new RemoteError(error.lspCode, error.message, { reason: error.message }, { cause: error })
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('lsp/failed', reason, { reason }, { cause: error })
    }
  }
}
