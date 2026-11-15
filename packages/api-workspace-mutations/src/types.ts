/**
 * Wire types for the workspace mutation Remote.
 *
 * The DTO mirrors the capability seam's result instead of importing it: Typert
 * generation copies only the Remote packages into a DSH checkout, where the
 * capability packages are absent.
 * @module @zifyai/dsh-api-workspace-mutations/types
 */

/** Result of a text write. */
export interface WorkspaceWriteResult {
  /** Workspace-relative path written. */
  readonly path: string
  /** SHA-256 of the new content. */
  readonly hash: string
  /** Bytes written. */
  readonly bytes: number
}
