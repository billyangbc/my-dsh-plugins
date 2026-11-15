/**
 * Workspace mutation seam: write, create, remove, and rename entries under a Session workspace root.
 * @module @zifyai/dsh-workspace-mutations
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-error'

/** Result of a text write. */
export interface WorkspaceWriteResult {
  /** Workspace-relative path written. */
  readonly path: string
  /** SHA-256 of the new content. */
  readonly hash: string
  /** Bytes written. */
  readonly bytes: number
}

/** Why a caller path was refused before any filesystem change. */
export type WorkspacePathReason = 'absolute' | 'escape' | 'symlink' | 'too-large'

/** A mutation refused because the caller path would leave the workspace root or misuse a link. */
export class WorkspacePathError extends HarnessError {
  /**
   * @param path - refused workspace-relative path.
   * @param reason - which containment rule rejected it.
   * @param message - human diagnostic naming the path and rule.
   * @param options - standard Error options.
   */
  constructor(
    readonly path: string,
    readonly reason: WorkspacePathReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, reason === 'too-large' ? 'workspace/too-large' : 'workspace/invalid-path', options)
  }
}

/** A mutation refused because the target does not exist. */
export class WorkspaceNotFoundError extends HarnessError {
  /** @param path - missing workspace-relative path. */
  constructor(readonly path: string) {
    super(`path does not exist: ${path}`, 'workspace/not-found')
  }
}

/** A removal refused because the directory still has entries. */
export class WorkspaceNotEmptyError extends HarnessError {
  /** @param path - non-empty workspace-relative directory. */
  constructor(readonly path: string) {
    super(`directory is not empty: ${path}`, 'workspace/not-empty')
  }
}

/** A write or create refused because the target changed since the caller last read it, or already exists. */
export class WorkspaceConflictError extends HarnessError {
  /**
   * @param path - workspace-relative path that changed.
   * @param message - human diagnostic; defaults to the changed-since-read wording.
   */
  constructor(readonly path: string, message?: string) {
    super(message ?? `file changed since it was read: ${path}`, 'workspace/conflict')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceMutations: WorkspaceMutations
  }
}

/** Safe mutations inside one workspace root; paths are always root-relative. */
export abstract class WorkspaceMutations extends Service {
  /**
   * @param ctx - owning Host context.
   */
  constructor(ctx: Context) {
    super(ctx, 'workspaceMutations')
  }

  /**
   * Write UTF-8 text to an existing file, or create it, never following a symbolic link.
   * @param root - absolute workspace root.
   * @param path - root-relative path.
   * @param content - UTF-8 text.
   * @param expectedHash - current content hash a caller read; a mismatch fails with {@link WorkspaceConflictError}.
   * @returns the new hash and byte count.
   */
  abstract write(root: string, path: string, content: string, expectedHash?: string): Promise<WorkspaceWriteResult>

  /**
   * Create a new file; an existing entry of any kind fails with {@link WorkspaceConflictError}.
   * @param root - absolute workspace root.
   * @param path - root-relative path.
   * @param content - UTF-8 text.
   * @returns the new hash and byte count.
   */
  abstract create(root: string, path: string, content: string): Promise<WorkspaceWriteResult>

  /**
   * Remove one file or empty directory. A symbolic link is removed as an entry; its target is never touched.
   * @param root - absolute workspace root.
   * @param path - root-relative path.
   */
  abstract remove(root: string, path: string): Promise<void>

  /**
   * Rename or move one entry, including a symbolic link as the entry itself.
   * @param root - absolute workspace root.
   * @param from - root-relative source path.
   * @param to - root-relative destination path.
   */
  abstract rename(root: string, from: string, to: string): Promise<void>

  /**
   * Create one directory.
   * @param root - absolute workspace root.
   * @param path - root-relative path.
   */
  abstract mkdir(root: string, path: string): Promise<void>
}
