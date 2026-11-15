/**
 * Local Git provider: runs the configured `git` executable through `ctx.subprocess`.
 * @module @zifyai/dsh-git-local
 */

import { isAbsolute, join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { GitError, GitService } from '@zifyai/dsh-git'
import type { GitChange, GitCommit, GitCommitDetail, GitCommitResult, GitPushResult, GitStatus } from '@zifyai/dsh-git'
import z from '@deepseek-ai/schemastery'

/** Provider configuration. */
export interface Config {
  /** Git executable name or absolute path. */
  readonly gitCommand: string
  /** Per-command deadline in milliseconds. */
  readonly timeoutMs: number
  /** Collected stdout/stderr cap per command in bytes. */
  readonly maxOutputBytes: number
  /** Grace period between `terminate()` and forced kill, in milliseconds. */
  readonly graceMs: number
  /** Maximum rows a history request may return. */
  readonly logLimit: number
  /** Maximum commits a graph request may render. */
  readonly graphLimit: number
}

/** Cordis schema for {@link Config}. */
export const Config: z<Config> = z.object({
  gitCommand: z.string().default('git').description('Git executable name or absolute path.'),
  timeoutMs: z.natural().min(1).default(15_000).description('Per-command deadline in milliseconds.'),
  maxOutputBytes: z.natural().min(1).default(4 * 1024 * 1024).description('Collected output cap per command in bytes.'),
  graceMs: z.natural().min(1).default(2_000).description('Grace period between terminate() and forced kill.'),
  logLimit: z.natural().min(1).default(200).description('Maximum rows a history request may return.'),
  graphLimit: z.natural().min(1).default(500).description('Maximum commits a graph request may render.'),
})

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

/** Local Git operations for one working directory per call. */
export default class GitLocal extends GitService {
  static inject = ['subprocess']

  static Config: z<Config> = Config

  /**
   * @param ctx - Host context carrying the subprocess capability.
   * @param config - executable, deadlines, and output caps.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx)
  }

  async status(cwd: string, signal?: AbortSignal): Promise<GitStatus> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    const inside = await this.runRaw(cwdChecked, ['rev-parse', '--is-inside-work-tree'], signal)
    if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') return { repository: false, changes: [] }
    const branchResult = await this.runRaw(cwdChecked, ['rev-parse', '--abbrev-ref', 'HEAD'], signal)
    const branch = branchResult.exitCode === 0 && branchResult.stdout.trim() !== 'HEAD'
      ? branchResult.stdout.trim()
      : undefined
    const remotes = await this.runRaw(cwdChecked, ['remote'], signal)
    const remoteNames = remotes.stdout.split('\n').map(name => name.trim()).filter(name => name !== '')
    const hasRemote = remoteNames.length > 0
    const upstreamResult = hasRemote
      ? await this.runRaw(cwdChecked, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], signal)
      : undefined
    const upstream = upstreamResult?.exitCode === 0 && upstreamResult.stdout.trim() !== ''
      ? upstreamResult.stdout.trim()
      : undefined
    const aheadResult = upstream === undefined
      ? undefined
      : await this.runRaw(cwdChecked, ['rev-list', '--count', `${upstream}..HEAD`], signal)
    const ahead = aheadResult?.exitCode === 0 ? Number.parseInt(aheadResult.stdout.trim(), 10) : undefined
    const porcelain = await this.run(cwdChecked, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)
    return {
      repository: true,
      ...(branch === undefined ? {} : { branch }),
      changes: this.parsePorcelain(porcelain.stdout),
      hasRemote,
      remotes: remoteNames,
      ...(upstream === undefined ? {} : { upstream }),
      ...(ahead === undefined || Number.isNaN(ahead) ? {} : { ahead }),
    }
  }

  async diff(cwd: string, path: string, staged: boolean, signal?: AbortSignal): Promise<string> {
    this.paths([path])
    signal?.throwIfAborted()
    const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path]
    return (await this.run(this.directory(cwd), args, signal)).stdout
  }

  async stage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<GitStatus> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    this.paths(paths)
    await this.run(cwdChecked, ['add', '--', ...paths], signal)
    return await this.status(cwdChecked, signal)
  }

  async unstage(cwd: string, paths: readonly string[], signal?: AbortSignal): Promise<GitStatus> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    this.paths(paths)
    const reset = await this.runRaw(cwdChecked, ['reset', '-q', 'HEAD', '--', ...paths], signal)
    if (reset.exitCode !== 0) {
      // Only an unborn HEAD needs the index removal; every other failure is reported as it happened.
      const head = await this.runRaw(cwdChecked, ['rev-parse', '--verify', '--quiet', 'HEAD'], signal)
      if (head.exitCode === 0) {
        throw new GitError(reset.stderr.trim() || `git reset exited with ${String(reset.exitCode)}`, 'git/failed')
      }
      await this.run(cwdChecked, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', ...paths], signal)
    }
    return await this.status(cwdChecked, signal)
  }

  async commit(cwd: string, message: string, signal?: AbortSignal): Promise<GitCommitResult> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    if (message.trim() === '') throw new GitError('commit message is empty', 'git/empty-message')
    const result = await this.run(cwdChecked, ['commit', '-m', message], signal)
    const hash = /^\[[^\]]*\s([0-9a-f]{7,40})\]/u.exec(result.stdout)?.[1]
      ?? (await this.run(cwdChecked, ['rev-parse', 'HEAD'], signal)).stdout.trim()
    return { hash, status: await this.status(cwdChecked, signal) }
  }

  async stageHunks(cwd: string, path: string, hunkHeaders: readonly string[], signal?: AbortSignal): Promise<GitStatus> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    this.paths([path])
    const diff = (await this.run(cwdChecked, ['diff', '--', path], signal)).stdout
    await this.applyPatch(cwdChecked, this.selectHunks(diff, hunkHeaders, path), ['--cached'], signal)
    return await this.status(cwdChecked, signal)
  }

  async unstageHunks(cwd: string, path: string, hunkHeaders: readonly string[], signal?: AbortSignal): Promise<GitStatus> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    this.paths([path])
    const diff = (await this.run(cwdChecked, ['diff', '--cached', '--', path], signal)).stdout
    await this.applyPatch(cwdChecked, this.selectHunks(diff, hunkHeaders, path), ['--cached', '-R'], signal)
    return await this.status(cwdChecked, signal)
  }

  async discardHunks(cwd: string, path: string, hunkHeaders: readonly string[], signal?: AbortSignal): Promise<GitStatus> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    this.paths([path])
    const diff = (await this.run(cwdChecked, ['diff', '--', path], signal)).stdout
    await this.applyPatch(cwdChecked, this.selectHunks(diff, hunkHeaders, path), ['-R'], signal)
    return await this.status(cwdChecked, signal)
  }

  async push(cwd: string, remoteName?: string, signal?: AbortSignal): Promise<GitPushResult> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    const remotes = await this.run(cwdChecked, ['remote'], signal)
    const names = remotes.stdout.split('\n').map(name => name.trim()).filter(name => name !== '')
    if (names.length === 0) throw new GitError('no remote configured', 'git/no-remote')
    if (remoteName !== undefined && !names.includes(remoteName)) {
      throw new GitError(`unknown remote: ${remoteName}`, 'git/unknown-remote', remoteName)
    }
    const upstream = await this.runRaw(cwdChecked, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], signal)
    const fallback = names.includes('origin') ? 'origin' : (names[0] as string)
    const result = remoteName !== undefined
      ? await this.run(cwdChecked, ['push', remoteName, 'HEAD'], signal)
      : upstream.exitCode === 0
        ? await this.run(cwdChecked, ['push'], signal)
        : await this.run(cwdChecked, ['push', '-u', fallback, 'HEAD'], signal)
    const output = `${result.stdout}${result.stderr}`.trim()
    return { status: await this.status(cwdChecked, signal), pushed: !/Everything up-to-date/iu.test(output), output }
  }

  async log(cwd: string, limit: number, signal?: AbortSignal): Promise<readonly GitCommit[]> {
    signal?.throwIfAborted()
    const result = await this.run(
      this.directory(cwd),
      ['log', `-n${String(this.limited(limit, this.config.logLimit))}`, '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%D%x1f%s'],
      signal,
    ).catch((error: unknown) => {
      // An empty repository reports "does not have any commits yet"; that is an empty history, not a failure.
      if (error instanceof GitError && error.code === 'git/failed') return undefined
      throw error
    })
    if (result === undefined || result.stdout.trim() === '') return []
    return result.stdout.split('\n').filter(line => line.includes('\x1f')).map(line => {
      const [hash = '', shortHash = '', author = '', date = '', parents = '', refs = '', subject = ''] = line.split('\x1f')
      return {
        hash,
        shortHash,
        author,
        date,
        subject,
        ...(parents.trim() === '' ? {} : { parents: parents.trim().split(' ') }),
        ...(refs.trim() === '' ? {} : { refs: refs.trim() }),
      }
    })
  }

  async graph(cwd: string, limit: number, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return (await this.run(
      this.directory(cwd),
      ['log', '--graph', '--oneline', '--decorate', '--all', '--no-color', `-n${String(this.limited(limit, this.config.graphLimit))}`],
      signal,
    )).stdout
  }

  async commitDetail(cwd: string, hash: string, signal?: AbortSignal): Promise<GitCommitDetail> {
    const cwdChecked = this.directory(cwd)
    signal?.throwIfAborted()
    if (!/^[0-9a-f]{7,40}$/iu.test(hash)) throw new GitError(`invalid commit hash: ${hash}`, 'git/invalid-hash', hash)
    const meta = await this.run(cwdChecked, ['show', '-s', '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%D%x1f%s', hash], signal)
    const [full = hash, shortHash = hash, author = '', date = '', parents = '', refs = '', subject = ''] = meta.stdout.split('\x1f')
    const patch = await this.run(cwdChecked, ['show', '--format=', '--patch', '--no-color', '--no-ext-diff', hash], signal)
    return {
      commit: {
        hash: full,
        shortHash,
        author,
        date,
        subject,
        ...(parents.trim() === '' ? {} : { parents: parents.trim().split(' ') }),
        ...(refs.trim() === '' ? {} : { refs: refs.trim() }),
      },
      patch: patch.stdout,
    }
  }

  /**
   * Parse `git status --porcelain=v1 -z` output.
   * @param raw - NUL-separated entries; a rename or copy entry is followed by its original path.
   * @returns one change per entry.
   */
  private parsePorcelain(raw: string): GitChange[] {
    const fields = raw.split('\0')
    const changes: GitChange[] = []
    for (let index = 0; index < fields.length; index += 1) {
      const entry = fields[index] ?? ''
      if (entry.length < 4) continue
      const code = entry.slice(0, 2)
      const path = entry.slice(3)
      // A rename or copy carries the original path as the next NUL-separated field; it is not an entry.
      if (code[0] === 'R' || code[0] === 'C') index += 1
      const untracked = code === '??'
      changes.push({
        path,
        status: untracked ? '?' : (code.trim() || '?'),
        staged: !untracked && code[0] !== ' ' && code[0] !== '?',
      })
    }
    return changes
  }

  /** Clamp a caller limit to the configured maximum. */
  private limited(limit: number, maximum: number): number {
    return Math.max(1, Math.min(maximum, Math.trunc(limit) || maximum))
  }

  private directory(cwd: string): string {
    if (!isAbsolute(cwd)) throw new GitError(`working directory must be absolute: ${cwd}`, 'git/invalid-cwd', cwd)
    return cwd
  }

  private paths(paths: readonly string[]): void {
    if (paths.length === 0) throw new GitError('no paths given', 'git/invalid-path')
    for (const path of paths) {
      if (path === '' || isAbsolute(path)) throw new GitError(`path must be repository-relative: ${path}`, 'git/invalid-path', path)
    }
  }

  private selectHunks(diff: string, headers: readonly string[], path: string): string {
    if (diff.trim() === '') throw new GitError(`no unstaged diff for ${path}`, 'git/empty-diff', path)
    const lines = diff.split('\n')
    const preamble: string[] = []
    const hunks: { header: string; body: string[] }[] = []
    for (const line of lines) {
      if (line.startsWith('@@ ')) {
        hunks.push({ header: line, body: [] })
        continue
      }
      if (hunks.length === 0) preamble.push(line)
      else hunks.at(-1)?.body.push(line)
    }
    const selected = hunks.filter(hunk => headers.includes(hunk.header))
    if (selected.length === 0) throw new GitError(`no matching hunk in ${path}`, 'git/no-match', path)
    const patch = [...preamble, ...selected.flatMap(hunk => [hunk.header, ...hunk.body])].join('\n')
    return patch.endsWith('\n') ? patch : `${patch}\n`
  }

  private async applyPatch(cwd: string, patch: string, flags: readonly string[], signal?: AbortSignal): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-git-'))
    const file = join(dir, 'patch.diff')
    try {
      await writeFile(file, patch, 'utf8')
      await this.run(cwd, ['apply', ...flags, '--whitespace=nowarn', file], signal)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Run one command and return its exit facts instead of throwing on a non-zero exit. */
  private async runRaw(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    return await this.spawn(cwd, args, signal)
  }

  /** Run one command, throwing on a non-zero exit, a truncated capture, or a deadline. */
  private async run(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    const result = await this.spawn(cwd, args, signal)
    if (result.exitCode !== 0) {
      throw new GitError(result.stderr.trim() || `git exited with ${String(result.exitCode)}`, 'git/failed', args[0])
    }
    return result
  }

  /**
   * Spawn `git` with the configured executable and caps.
   * @param cwd - absolute working directory.
   * @param args - arguments after the executable.
   * @param signal - caller cancellation.
   * @returns collected output and exit code; the child is terminated on a deadline.
   */
  private async spawn(cwd: string, args: readonly string[], signal?: AbortSignal): Promise<CommandResult> {
    const executable = await this.ctx.subprocess.resolveExecutable(this.config.gitCommand)
    const handle = this.ctx.subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: this.config.maxOutputBytes },
        stderr: { maxBytes: this.config.maxOutputBytes },
      },
      graceMs: this.config.graceMs,
      ...(signal === undefined ? {} : { signal }),
      env: { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new GitError(`git ${args[0] ?? ''} timed out after ${String(this.config.timeoutMs)}ms`, 'git/timeout', args[0]))
      }, this.config.timeoutMs)
    })
    let outcome
    try {
      outcome = await Promise.race([handle.done, deadline])
    } catch (error: unknown) {
      // The deadline must stop the child, otherwise a timed-out writer keeps mutating the repository.
      handle.terminate()
      await handle.waitForExit().catch(() => false)
      throw error
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    if (stdout?.lossy === true) {
      throw new GitError(
        `git ${args[0] ?? ''} output exceeded ${String(this.config.maxOutputBytes)} bytes`,
        'git/output-truncated',
        args[0],
      )
    }
    return { stdout: stdout?.text ?? '', stderr: stderr?.text ?? '', exitCode: outcome.exitCode ?? 1 }
  }
}
