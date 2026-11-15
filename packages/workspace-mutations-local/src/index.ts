/**
 * Local workspace mutation provider with root containment, never following symbolic links.
 * @module @zifyai/dsh-workspace-mutations-local
 */

import { constants as fsConstants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readFile, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  WorkspaceConflictError,
  WorkspaceMutations,
  WorkspaceNotEmptyError,
  WorkspaceNotFoundError,
  WorkspacePathError,
} from '@zifyai/dsh-workspace-mutations'
import type { WorkspaceWriteResult } from '@zifyai/dsh-workspace-mutations'

/** Provider configuration. */
export interface Config {
  /** Maximum accepted write or create payload in bytes. */
  readonly maxWriteBytes: number
}

/** Cordis schema for {@link Config}. */
export const Config: z<Config> = z.object({
  maxWriteBytes: z.natural().min(1).default(8 * 1024 * 1024)
    .description('Maximum accepted write or create payload in bytes.'),
})

/** SHA-256 hex digest of a buffer. */
function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Whether `target` is `root` or below it. */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

/** The filesystem error code a rejection carries, when it carries one. */
function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

/** Local filesystem mutations under one workspace root per call. */
export default class WorkspaceMutationsLocal extends WorkspaceMutations {
  static Config: z<Config> = Config

  /**
   * @param ctx - Host context.
   * @param config - payload size cap.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  async write(root: string, path: string, content: string, expectedHash?: string): Promise<WorkspaceWriteResult> {
    this.checkSize(path, content)
    const target = await this.resolve(root, path)
    await this.refuseLink(path, target)
    if (expectedHash !== undefined) {
      const current = await readFile(target).then(bytes => hashBytes(bytes), () => undefined)
      if (current !== expectedHash) throw new WorkspaceConflictError(path)
    }
    await this.writeNoFollow(target, content)
    return this.result(path, content)
  }

  async create(root: string, path: string, content: string): Promise<WorkspaceWriteResult> {
    this.checkSize(path, content)
    const target = await this.resolve(root, path)
    await this.refuseLink(path, target)
    try {
      await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
    } catch (error: unknown) {
      if (codeOf(error) === 'EEXIST') throw new WorkspaceConflictError(path, `path already exists: ${path}`)
      throw error
    }
    return this.result(path, content)
  }

  async remove(root: string, path: string): Promise<void> {
    const target = await this.resolve(root, path)
    const info = await lstat(target).catch(() => undefined)
    if (info === undefined) throw new WorkspaceNotFoundError(path)
    if (info.isSymbolicLink()) {
      await unlink(target)
      return
    }
    // A directory entry reached through an in-root parent can still contain links;
    // only an empty directory is removable, so nothing behind it is entered.
    if (!info.isDirectory()) {
      await unlink(target)
      return
    }
    try {
      await rmdir(target)
    } catch (error: unknown) {
      if (codeOf(error) === 'ENOTEMPTY' || codeOf(error) === 'EEXIST') throw new WorkspaceNotEmptyError(path)
      throw error
    }
  }

  async rename(root: string, from: string, to: string): Promise<void> {
    const source = await this.resolve(root, from)
    const destination = await this.resolve(root, to)
    const info = await lstat(source).catch(() => undefined)
    if (info === undefined) throw new WorkspaceNotFoundError(from)
    await this.refuseLink(to, destination)
    await rename(source, destination)
  }

  async mkdir(root: string, path: string): Promise<void> {
    const target = await this.resolve(root, path)
    await this.refuseLink(path, target)
    try {
      await mkdir(target)
    } catch (error: unknown) {
      if (codeOf(error) === 'EEXIST') throw new WorkspaceConflictError(path, `path already exists: ${path}`)
      throw error
    }
  }

  /**
   * Resolve a root-relative path, requiring its parent directory to exist inside the root.
   * @param root - workspace root.
   * @param path - caller path.
   * @returns the absolute, unresolved target path.
   * @throws WorkspacePathError when the path is absolute, escapes the root, or has no in-root parent.
   */
  private async resolve(root: string, path: string): Promise<string> {
    if (path === '' || isAbsolute(path)) {
      throw new WorkspacePathError(path, 'absolute', `path must be workspace-relative: ${path}`)
    }
    const normalized = normalize(path)
    if (normalized === '..' || normalized.startsWith(`..${sep}`)) {
      throw new WorkspacePathError(path, 'escape', `path escapes the workspace: ${path}`)
    }
    const realRoot = await realpath(root)
    const target = resolve(realRoot, normalized)
    if (!isWithin(target, realRoot)) {
      throw new WorkspacePathError(path, 'escape', `path escapes the workspace: ${path}`)
    }
    const parent = await realpath(dirname(target)).catch((error: unknown) => {
      throw new WorkspacePathError(path, 'escape', `parent directory does not exist: ${path}`, { cause: error })
    })
    if (!isWithin(parent, realRoot)) {
      throw new WorkspacePathError(path, 'escape', `path escapes the workspace: ${path}`)
    }
    return target
  }

  /** Refuse a target that is itself a symbolic link, so no operation writes through it. */
  private async refuseLink(path: string, target: string): Promise<void> {
    const info = await lstat(target).catch(() => undefined)
    if (info?.isSymbolicLink() === true) {
      throw new WorkspacePathError(path, 'symlink', `refusing to write through a symbolic link: ${path}`)
    }
  }

  /** Write through a descriptor opened with `O_NOFOLLOW`, closing the check/write race on POSIX. */
  private async writeNoFollow(target: string, content: string): Promise<void> {
    const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC
      | (fsConstants.O_NOFOLLOW ?? 0)
    const handle = await open(target, flags, 0o644)
    try {
      await handle.writeFile(content, 'utf8')
    } finally {
      await handle.close()
    }
  }

  /** Refuse a payload above the configured cap before touching the filesystem. */
  private checkSize(path: string, content: string): void {
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes > this.config.maxWriteBytes) {
      throw new WorkspacePathError(
        path,
        'too-large',
        `write of ${String(bytes)} bytes exceeds the ${String(this.config.maxWriteBytes)}-byte limit: ${path}`,
      )
    }
  }

  /** The result of a successful text write. */
  private result(path: string, content: string): WorkspaceWriteResult {
    const bytes = Buffer.from(content, 'utf8')
    return { path, hash: hashBytes(bytes), bytes: bytes.length }
  }
}
