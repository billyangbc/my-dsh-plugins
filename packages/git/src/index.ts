/**
 * Git capability seam: workspace status, diffs, staging, commits, and history.
 * @module @zifyai/dsh-git
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'

/** One working-tree row. */
export interface GitChange {
  /** Repository-relative path. */
  readonly path: string
  /** Porcelain status code (`M`, `A`, `D`, `R`, `?`); `??` is normalized to `?`. */
  readonly status: string
  /** Whether the change is staged. */
  readonly staged: boolean
}

/** Working-tree state for one repository. */
export interface GitStatus {
  /** Current branch name, or `undefined` for a detached HEAD or unborn branch. */
  readonly branch?: string | undefined
  /** Working-tree and index changes. */
  readonly changes: readonly GitChange[]
  /** Whether the directory is inside a Git work tree. */
  readonly repository: boolean
  /** Upstream branch name, when one is configured. */
  readonly upstream?: string | undefined
  /** Commits ahead of the upstream; absent without an upstream. */
  readonly ahead?: number | undefined
  /** Whether any remote is configured. */
  readonly hasRemote?: boolean | undefined
  /** Configured remote names. */
  readonly remotes?: readonly string[] | undefined
}

/** Result of a push. */
export interface GitPushResult {
  /** Working tree after the push. */
  readonly status: GitStatus
  /** Whether the command published anything. */
  readonly pushed: boolean
  /** Git's own output. */
  readonly output: string
}

/** One commit row. */
export interface GitCommit {
  /** Full commit hash. */
  readonly hash: string
  /** Abbreviated hash. */
  readonly shortHash: string
  /** Author name. */
  readonly author: string
  /** Author time in ISO 8601. */
  readonly date: string
  /** Subject line. */
  readonly subject: string
  /** Parent hashes, in Git order. */
  readonly parents?: readonly string[] | undefined
  /** Decorations (`HEAD -> main, origin/main`, tags). */
  readonly refs?: string | undefined
}

/** One commit with its full patch. */
export interface GitCommitDetail {
  /** Commit metadata. */
  readonly commit: GitCommit
  /** Unified patch for every changed file. */
  readonly patch: string
}

/** Result of a commit. */
export interface GitCommitResult {
  /** New commit hash. */
  readonly hash: string
  /** Working tree after the commit. */
  readonly status: GitStatus
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    git: GitService
  }
}

/** Stable failure classes a Git provider reports. */
export type GitErrorCode =
  | 'git/not-repository'
  | 'git/invalid-cwd'
  | 'git/invalid-path'
  | 'git/invalid-hash'
  | 'git/empty-message'
  | 'git/no-remote'
  | 'git/unknown-remote'
  | 'git/no-match'
  | 'git/empty-diff'
  | 'git/timeout'
  | 'git/output-truncated'
  | 'git/failed'

/** A Git operation that could not complete, with the failing operation and subject. */
export class GitError extends HarnessError {
  /**
   * @param message - human diagnostic naming what failed.
   * @param gitCode - stable failure class.
   * @param subject - the path, ref, or hash the failure concerns, when it concerns one.
   * @param options - standard Error options.
   */
  constructor(message: string, readonly gitCode: GitErrorCode, readonly subject?: string, options?: ErrorOptions) {
    super(message, gitCode, options)
  }
}

/** Host-side Git operations scoped to one working directory per call. */
export abstract class GitService extends Service {
  /**
   * @param ctx - owning Host context.
   */
  constructor(ctx: Context) {
    super(ctx, 'git')
  }

  /**
   * Read working-tree state.
   * @param cwd - absolute working directory.
   * @param signal - caller cancellation.
   * @returns branch and changes; `repository: false` outside a work tree.
   */
  abstract status(cwd: string, signal?: AbortSignal): Promise<GitStatus>

  /**
   * Read a unified diff for one path.
   * @param cwd - absolute working directory.
   * @param path - repository-relative path.
   * @param staged - read the index instead of the work tree.
   * @param signal - caller cancellation.
   * @returns unified diff text.
   */
  abstract diff(cwd: string, path: string, staged: boolean, signal?: AbortSignal): Promise<string>

  /**
   * Stage paths.
   * @param cwd - absolute working directory.
   * @param paths - repository-relative paths.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  abstract stage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<GitStatus>

  /**
   * Unstage paths without touching the work tree.
   * @param cwd - absolute working directory.
   * @param paths - repository-relative paths.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  abstract unstage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<GitStatus>

  /**
   * Commit the index.
   * @param cwd - absolute working directory.
   * @param message - commit message; must be non-empty.
   * @param signal - caller cancellation.
   * @returns the new commit and refreshed status.
   */
  abstract commit(cwd: string, message: string, signal?: AbortSignal): Promise<GitCommitResult>

  /**
   * Stage selected hunks of one path.
   * @param cwd - absolute working directory.
   * @param path - repository-relative path.
   * @param hunkHeaders - `@@` header lines selecting hunks from the unstaged diff.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  abstract stageHunks(cwd: string, path: string, hunkHeaders: readonly string[], signal?: AbortSignal): Promise<GitStatus>

  /**
   * Unstage selected hunks of one path.
   * @param cwd - absolute working directory.
   * @param path - repository-relative path.
   * @param hunkHeaders - `@@` header lines selecting hunks from the staged diff.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  abstract unstageHunks(cwd: string, path: string, hunkHeaders: readonly string[], signal?: AbortSignal): Promise<GitStatus>

  /**
   * Discard selected hunks from the work tree.
   * @param cwd - absolute working directory.
   * @param path - repository-relative path.
   * @param hunkHeaders - `@@` header lines selecting hunks from the unstaged diff.
   * @param signal - caller cancellation.
   * @returns refreshed status.
   */
  abstract discardHunks(cwd: string, path: string, hunkHeaders: readonly string[], signal?: AbortSignal): Promise<GitStatus>

  /**
   * Push the current branch.
   * @param cwd - absolute working directory.
   * @param remote - remote name; omitted uses the upstream's remote or `origin`.
   * @param signal - caller cancellation.
   * @returns push output and refreshed status.
   */
  abstract push(cwd: string, remote?: string, signal?: AbortSignal): Promise<GitPushResult>

  /**
   * Read recent commits.
   * @param cwd - absolute working directory.
   * @param limit - maximum rows.
   * @param signal - caller cancellation.
   * @returns newest-first commits.
   */
  abstract log(cwd: string, limit: number, signal?: AbortSignal): Promise<readonly GitCommit[]>

  /**
   * Render an ASCII commit graph for all refs.
   * @param cwd - absolute working directory.
   * @param limit - maximum commits.
   * @param signal - caller cancellation.
   * @returns colored-free graph text.
   */
  abstract graph(cwd: string, limit: number, signal?: AbortSignal): Promise<string>

  /**
   * Read one commit's metadata and full patch.
   * @param cwd - absolute working directory.
   * @param hash - commit hash.
   * @param signal - caller cancellation.
   * @returns commit metadata and patch.
   */
  abstract commitDetail(cwd: string, hash: string, signal?: AbortSignal): Promise<GitCommitDetail>
}
