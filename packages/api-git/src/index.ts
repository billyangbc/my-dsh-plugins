/**
 * Git Remote controller: exposes Session working-tree operations to the Client.
 * @module @zifyai/dsh-api-git
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { GitError } from '@zifyai/dsh-git'
import type { GitCommit, GitCommitDetail, GitCommitResult, GitPushResult, GitStatus } from './types.ts'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Session has no workspace directory. */
    'git/no-workspace': { readonly sessionId: string }
    /** The calling principal is not allowed to read this Session's repository. */
    'git/forbidden': { readonly sessionId: string }
    /** The directory is not inside a Git work tree. */
    'git/not-repository': { readonly reason: string }
    /** The caller named an unusable path, hash, or working directory. */
    'git/invalid-path': { readonly reason: string }
    'git/invalid-cwd': { readonly reason: string }
    'git/invalid-hash': { readonly reason: string }
    /** The commit message was empty. */
    'git/empty-message': { readonly reason: string }
    /** No remote is configured. */
    'git/no-remote': { readonly reason: string }
    /** The named remote does not exist. */
    'git/unknown-remote': { readonly reason: string }
    /** No hunk matched the requested selection. */
    'git/no-match': { readonly reason: string }
    /** There is no diff to apply. */
    'git/empty-diff': { readonly reason: string }
    /** A Git command exceeded its deadline and was terminated. */
    'git/timeout': { readonly reason: string }
    /** A Git command produced more output than the provider retains. */
    'git/output-truncated': { readonly reason: string }
    /** The command failed for any other reason. */
    'git/failed': { readonly reason: string }
  }
}

/** Git Remote namespace for the calling Session's working directory. */
export default class GitController extends TypertRemoteService {
  static inject = ['git', 'sessions', 'remoteAccess']

  /**
   * @param ctx - Host context carrying the Git capability, Session store, and access policy.
   */
  constructor(ctx: Context) {
    super(ctx, 'gitController', { namespace: 'git' })
  }

  /**
   * Read the Session workspace's working-tree state.
   * @param sessionId - calling Session identity.
   * @param signal - caller cancellation.
   * @returns branch, changes, and repository flag.
   */
  @Remote('status')
  async statusForClient(sessionId: SessionId, signal: AbortSignal): Promise<GitStatus> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.status(this.cwd(sessionId), signal))
  }

  /**
   * Read one path's unified diff.
   * @param sessionId - calling Session identity.
   * @param path - repository-relative path.
   * @param staged - read the index instead of the work tree.
   * @param signal - caller cancellation.
   * @returns unified diff text.
   */
  @Remote('diff')
  async diffForClient(sessionId: SessionId, path: string, staged: boolean, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.diff(this.cwd(sessionId), path, staged, signal))
  }

  /**
   * Stage paths.
   * @param sessionId - calling Session identity.
   * @param paths - repository-relative paths.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  @Remote('stage')
  async stageForClient(sessionId: SessionId, paths: readonly string[], signal: AbortSignal): Promise<GitStatus> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.stage(this.cwd(sessionId), paths, signal))
  }

  /**
   * Unstage paths.
   * @param sessionId - calling Session identity.
   * @param paths - repository-relative paths.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  @Remote('unstage')
  async unstageForClient(sessionId: SessionId, paths: readonly string[], signal: AbortSignal): Promise<GitStatus> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.unstage(this.cwd(sessionId), paths, signal))
  }

  /**
   * Stage selected hunks of one path.
   * @param sessionId - calling Session identity.
   * @param path - repository-relative path.
   * @param hunkHeaders - `@@` headers selecting hunks from the unstaged diff.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  @Remote('stageHunks')
  async stageHunksForClient(sessionId: SessionId, path: string, hunkHeaders: readonly string[], signal: AbortSignal): Promise<GitStatus> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.stageHunks(this.cwd(sessionId), path, hunkHeaders, signal))
  }

  /**
   * Unstage selected hunks of one path.
   * @param sessionId - calling Session identity.
   * @param path - repository-relative path.
   * @param hunkHeaders - `@@` headers selecting hunks from the staged diff.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  @Remote('unstageHunks')
  async unstageHunksForClient(sessionId: SessionId, path: string, hunkHeaders: readonly string[], signal: AbortSignal): Promise<GitStatus> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.unstageHunks(this.cwd(sessionId), path, hunkHeaders, signal))
  }

  /**
   * Discard selected hunks from the work tree.
   * @param sessionId - calling Session identity.
   * @param path - repository-relative path.
   * @param hunkHeaders - `@@` headers selecting hunks from the unstaged diff.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  @Remote('discardHunks')
  async discardHunksForClient(sessionId: SessionId, path: string, hunkHeaders: readonly string[], signal: AbortSignal): Promise<GitStatus> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.discardHunks(this.cwd(sessionId), path, hunkHeaders, signal))
  }

  /**
   * Push the current branch.
   * @param sessionId - calling Session identity.
   * @param remote - remote name; omitted uses the configured upstream or the provider's default.
   * @param signal - caller cancellation.
   * @returns push output and refreshed status.
   */
  @Remote('push')
  async pushForClient(sessionId: SessionId, remote: string | undefined, signal: AbortSignal): Promise<GitPushResult> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.push(this.cwd(sessionId), remote, signal))
  }

  /**
   * Commit the index.
   * @param sessionId - calling Session identity.
   * @param message - non-empty commit message.
   * @param signal - caller cancellation.
   * @returns the new commit and refreshed status.
   */
  @Remote('commit')
  async commitForClient(sessionId: SessionId, message: string, signal: AbortSignal): Promise<GitCommitResult> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.commit(this.cwd(sessionId), message, signal))
  }

  /**
   * Read recent commits.
   * @param sessionId - calling Session identity.
   * @param limit - maximum rows.
   * @param signal - caller cancellation.
   * @returns newest-first commits.
   */
  @Remote('log')
  async logForClient(sessionId: SessionId, limit: number, signal: AbortSignal): Promise<readonly GitCommit[]> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.log(this.cwd(sessionId), limit, signal))
  }

  /**
   * Render the commit graph.
   * @param sessionId - calling Session identity.
   * @param limit - maximum commits.
   * @param signal - caller cancellation.
   * @returns graph text.
   */
  @Remote('graph')
  async graphForClient(sessionId: SessionId, limit: number, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.graph(this.cwd(sessionId), limit, signal))
  }

  /**
   * Read one commit's metadata and patch.
   * @param sessionId - calling Session identity.
   * @param hash - commit hash.
   * @param signal - caller cancellation.
   * @returns commit metadata and patch.
   */
  @Remote('commitDetail')
  async commitDetailForClient(sessionId: SessionId, hash: string, signal: AbortSignal): Promise<GitCommitDetail> {
    signal.throwIfAborted()
    return await this.fail(() => this.ctx.git.commitDetail(this.cwd(sessionId), hash, signal))
  }

  /**
   * Resolve the calling Session's working directory after checking access.
   * @param sessionId - calling Session identity.
   * @returns the absolute working directory.
   */
  private cwd(sessionId: SessionId): string {
    if (!this.ctx.remoteAccess.allows({ kind: 'session', id: sessionId })) {
      throw new RemoteError('git/forbidden', `not allowed to read session ${sessionId}`, { sessionId })
    }
    const cwd = this.ctx.sessions.get(sessionId)?.header.cwd
    if (cwd === undefined) throw new RemoteError('git/no-workspace', `session ${sessionId} has no workspace`, { sessionId })
    return cwd
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
      if (error instanceof GitError) {
        throw new RemoteError(error.gitCode, error.message, { reason: error.message }, { cause: error })
      }
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('git/failed', reason, { reason }, { cause: error })
    }
  }
}
