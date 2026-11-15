/**
 * Workspace mutation Remote: write, create, remove, rename, and create directories under the calling Session workspace.
 * @module @zifyai/dsh-api-workspace-mutations
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  WorkspaceConflictError,
  WorkspaceNotEmptyError,
  WorkspaceNotFoundError,
  WorkspacePathError,
} from '@zifyai/dsh-workspace-mutations'
import type { WorkspaceWriteResult } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Session has no workspace directory. */
    'workspaceEdit/no-workspace': { readonly sessionId: string }
    /** The calling principal is not allowed to mutate this Session's workspace. */
    'workspaceEdit/forbidden': { readonly sessionId: string }
    /** The write was refused because the file changed since it was read, or the path already exists. */
    'workspaceEdit/conflict': { readonly path: string }
    /** The path does not exist. */
    'workspaceEdit/not-found': { readonly path: string }
    /** The directory still has entries. */
    'workspaceEdit/not-empty': { readonly path: string }
    /** The payload exceeds the provider's write limit. */
    'workspaceEdit/too-large': { readonly path: string; readonly reason: string }
    /** The path is absolute, escapes the workspace, or resolves through a symbolic link. */
    'workspaceEdit/invalid-path': { readonly path: string; readonly reason: string }
    /** The mutation failed for any other reason. */
    'workspaceEdit/failed': { readonly reason: string }
  }
}

/** Workspace mutations bound to the calling Session's working directory. */
export default class WorkspaceMutationsController extends TypertRemoteService {
  static inject = ['workspaceMutations', 'sessions', 'remoteAccess']

  /**
   * @param ctx - Host context carrying the mutation capability, Session store, and access policy.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceEditController', { namespace: 'workspaceEdit' })
  }

  /**
   * Write UTF-8 text to a workspace file.
   * @param sessionId - calling Session identity.
   * @param path - workspace-relative path.
   * @param content - UTF-8 text.
   * @param expectedHash - hash of the content the caller read; a mismatch fails with a conflict.
   * @param signal - caller cancellation.
   * @returns the new hash and byte count.
   */
  @Remote('write')
  async writeForClient(sessionId: SessionId, path: string, content: string, expectedHash: string | undefined, signal: AbortSignal): Promise<WorkspaceWriteResult> {
    signal.throwIfAborted()
    return await this.fail(path, () => this.ctx.workspaceMutations.write(this.root(sessionId), path, content, expectedHash))
  }

  /**
   * Create a new file; an existing entry fails with a conflict instead of being truncated.
   * @param sessionId - calling Session identity.
   * @param path - workspace-relative path.
   * @param content - UTF-8 text.
   * @param signal - caller cancellation.
   * @returns the new hash and byte count.
   */
  @Remote('createFile')
  async createForClient(sessionId: SessionId, path: string, content: string, signal: AbortSignal): Promise<WorkspaceWriteResult> {
    signal.throwIfAborted()
    return await this.fail(path, () => this.ctx.workspaceMutations.create(this.root(sessionId), path, content))
  }

  /**
   * Remove one file or empty directory.
   * @param sessionId - calling Session identity.
   * @param path - workspace-relative path.
   * @param signal - caller cancellation.
   */
  @Remote('deleteFile')
  async removeForClient(sessionId: SessionId, path: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.fail(path, () => this.ctx.workspaceMutations.remove(this.root(sessionId), path))
  }

  /**
   * Rename or move one entry.
   * @param sessionId - calling Session identity.
   * @param from - workspace-relative source path.
   * @param to - workspace-relative destination path.
   * @param signal - caller cancellation.
   */
  @Remote('moveFile')
  async renameForClient(sessionId: SessionId, from: string, to: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.fail(from, () => this.ctx.workspaceMutations.rename(this.root(sessionId), from, to))
  }

  /**
   * Create one directory.
   * @param sessionId - calling Session identity.
   * @param path - workspace-relative path.
   * @param signal - caller cancellation.
   */
  @Remote('mkdir')
  async mkdirForClient(sessionId: SessionId, path: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    await this.fail(path, () => this.ctx.workspaceMutations.mkdir(this.root(sessionId), path))
  }

  /**
   * Resolve the calling Session's workspace root after checking access.
   * @param sessionId - calling Session identity.
   * @returns the absolute workspace root.
   */
  private root(sessionId: SessionId): string {
    if (!this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
      throw new RemoteError('workspaceEdit/forbidden', `not allowed to edit session ${sessionId}`, { sessionId })
    }
    const cwd = this.ctx.sessions.get(sessionId)?.header.cwd
    if (cwd === undefined) {
      throw new RemoteError('workspaceEdit/no-workspace', `session ${sessionId} has no workspace`, { sessionId })
    }
    return cwd
  }

  /**
   * Run one mutation, mapping the capability's typed failures onto Remote codes.
   * @param path - path named by the failure.
   * @param operation - the mutation to await.
   * @returns the operation result.
   */
  private async fail<T>(path: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      if (error instanceof WorkspaceConflictError) {
        throw new RemoteError('workspaceEdit/conflict', error.message, { path }, { cause: error })
      }
      if (error instanceof WorkspaceNotFoundError) {
        throw new RemoteError('workspaceEdit/not-found', error.message, { path }, { cause: error })
      }
      if (error instanceof WorkspaceNotEmptyError) {
        throw new RemoteError('workspaceEdit/not-empty', error.message, { path }, { cause: error })
      }
      if (error instanceof WorkspacePathError) {
        const code = error.code === 'workspace/too-large' ? 'workspaceEdit/too-large' : 'workspaceEdit/invalid-path'
        throw new RemoteError(code, error.message, { path, reason: error.reason }, { cause: error })
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('workspaceEdit/failed', reason, { reason }, { cause: error })
    }
  }
}
