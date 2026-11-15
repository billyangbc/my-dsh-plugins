/**
 * Wire types for the Git Remote.
 *
 * These mirror the capability seam's DTOs instead of importing them: Typert
 * generation copies only the Remote packages into a DSH checkout, where the
 * capability packages are absent, so a cross-package type reference cannot be
 * resolved. `fixtures/bundle-check.mjs` and the provider checks exercise both
 * sides together, which is what keeps the two declarations honest.
 * @module @zifyai/dsh-api-git/types
 */

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
