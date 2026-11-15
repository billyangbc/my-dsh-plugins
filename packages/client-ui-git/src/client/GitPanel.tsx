/**
 * Minimal Git panel: status, stage/unstage, diff, commit, and recent history.
 * @module @zifyai/dsh-client-ui-git/GitPanel
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { GitChange, GitCommit, GitCommitDetail, GitCommitResult, GitPushResult, GitStatus } from '@zifyai/dsh-api-git/types'
import { translator } from './locales.ts'

/** Remote operations bound to the panel's Session. */
export interface GitApi {
  /** Read working-tree state. */
  status: (signal?: AbortSignal) => Promise<GitStatus>
  /** Read one path's diff. */
  diff: (path: string, staged: boolean, signal?: AbortSignal) => Promise<string>
  /** Stage paths. */
  stage: (paths: readonly string[], signal?: AbortSignal) => Promise<GitStatus>
  /** Unstage paths. */
  unstage: (paths: readonly string[], signal?: AbortSignal) => Promise<GitStatus>
  /** Commit the index. */
  commit: (message: string, signal?: AbortSignal) => Promise<GitCommitResult>
  /** Stage selected hunks. */
  stageHunks: (path: string, headers: readonly string[], signal?: AbortSignal) => Promise<GitStatus>
  /** Unstage selected hunks. */
  unstageHunks: (path: string, headers: readonly string[], signal?: AbortSignal) => Promise<GitStatus>
  /** Discard selected hunks from the work tree. */
  discardHunks: (path: string, headers: readonly string[], signal?: AbortSignal) => Promise<GitStatus>
  /** Push the current branch. */
  push: (remote: string | undefined, signal?: AbortSignal) => Promise<GitPushResult>
  /** Read one commit's metadata and patch. */
  commitDetail: (hash: string, signal?: AbortSignal) => Promise<GitCommitDetail>
  /** Render the ASCII commit graph. */
  graph: (limit: number, signal?: AbortSignal) => Promise<string>
  /** Read recent commits. */
  log: (limit: number, signal?: AbortSignal) => Promise<readonly GitCommit[]>
}

/** Props supplied by the slot registration. */
export interface GitPanelProps {
  /** Calling Session identity. */
  readonly sessionId: string
  /** Remote operations for that Session. */
  readonly api: GitApi
}

const panel: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
  font: '13px/1.45 var(--dsw-alias-font-family, system-ui, sans-serif)',
  color: 'var(--dsw-alias-text-primary, #1f2328)',
  background: 'var(--dsw-alias-bg-base, #fff)',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
  color: 'var(--dsw-alias-text-tertiary, #6b7280)', padding: '10px 12px 4px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 12px', cursor: 'pointer',
}
const actionStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-default, #d0d7de)', background: 'transparent',
  borderRadius: 6, padding: '1px 6px', fontSize: 11, cursor: 'pointer',
  color: 'var(--dsw-alias-text-secondary, #4b5563)',
}
const buttonPrimary: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
  background: 'var(--dsw-alias-state-business-primary, #0969da)', color: '#fff',
}

/** Render diff lines with add/remove/hunk colors. */
function DiffText({ text }: { readonly text: string }): ReactNode {
  return (
    <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.45, overflow: 'auto', maxHeight: 260 }}>
      {text.split('\n').map((line, index) => {
        const color = line.startsWith('+') && !line.startsWith('+++') ? '#1a7f37'
          : line.startsWith('-') && !line.startsWith('---') ? '#cf222e'
            : line.startsWith('@@') ? '#0969da'
              : undefined
        return (
          <div key={index} style={color === undefined ? undefined : { color }}>
            {line === '' ? ' ' : line}
          </div>
        )
      })}
    </pre>
  )
}

/** Split a full patch into per-file sections. */
function splitPatch(patch: string): { path: string; body: string }[] {
  const files: { path: string; body: string[] }[] = []
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = / b\/(.+)$/u.exec(line)
      files.push({ path: match?.[1] ?? line.slice(11), body: [line] })
    } else if (files.length > 0) files.at(-1)?.body.push(line)
  }
  return files.map(file => ({ path: file.path, body: file.body.join('\n') }))
}

/** Split a unified diff into its hunks; the file preamble is omitted. */
function splitHunks(diff: string): { header: string; body: string }[] {
  const hunks: { header: string; body: string[] }[] = []
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@ ')) hunks.push({ header: line, body: [] })
    else if (hunks.length > 0) hunks.at(-1)?.body.push(line)
  }
  return hunks.map(hunk => ({ header: hunk.header, body: hunk.body.join('\n') }))
}

/**
 * Render the panel for one Session.
 * @param props - Session identity and bound Remote operations.
 * @returns the panel element.
 */
export function GitPanel({ sessionId, api }: GitPanelProps): ReactNode {
  const t = translator()
  const [status, setStatus] = useState<GitStatus | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<{ path: string; staged: boolean } | undefined>(undefined)
  const [diff, setDiff] = useState('')
  const [message, setMessage] = useState('')
  const [commits, setCommits] = useState<readonly GitCommit[] | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [detail, setDetail] = useState<GitCommitDetail | undefined>(undefined)
  const [graphText, setGraphText] = useState<string | undefined>(undefined)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      setError(undefined)
      setStatus(await api.status(signal))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh, sessionId])

  const staged = useMemo(() => status?.changes.filter(change => change.staged) ?? [], [status])
  const unstaged = useMemo(() => status?.changes.filter(change => !change.staged) ?? [], [status])

  const act = useCallback(async (operation: () => Promise<GitStatus>) => {
    setBusy(true)
    setNotice(undefined)
    try {
      setStatus(await operation())
      setError(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const showDiff = useCallback(async (path: string, isStaged: boolean) => {
    setSelected({ path, staged: isStaged })
    try {
      setDiff(await api.diff(path, isStaged))
    } catch (cause: unknown) {
      setDiff(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])

  const commit = useCallback(async () => {
    if (message.trim() === '') return
    setBusy(true)
    try {
      const result = await api.commit(message)
      setStatus(result.status)
      setMessage('')
      setNotice(t('panel.committed', { hash: result.hash.slice(0, 8) }))
      setCommits(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, message])

  const [remote, setRemote] = useState<string | undefined>(undefined)

  const pushRemote = remote ?? status?.remotes?.[0]

  const push = useCallback(async () => {
    setBusy(true)
    try {
      // Send the remote the select displays; omitting it lets the provider pick a different default.
      const result = await api.push(pushRemote)
      setStatus(result.status)
      setNotice(result.pushed ? t('panel.pushed') : t('panel.nothingToPush'))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api, pushRemote])

  const actHunks = useCallback(async (kind: 'stage' | 'unstage' | 'discard', path: string, header: string) => {
    setBusy(true)
    try {
      const next = kind === 'stage'
        ? await api.stageHunks(path, [header])
        : kind === 'unstage' ? await api.unstageHunks(path, [header]) : await api.discardHunks(path, [header])
      setStatus(next)
      setSelected(undefined)
      setDiff('')
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [api])

  const loadLog = useCallback(async () => {
    try {
      setCommits(await api.log(30))
      setError(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])

  const openGraph = useCallback(async () => {
    try {
      setGraphText(await api.graph(80))
      setCommits([])
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [api])

  const openCommit = useCallback(async (hash: string) => {
    setDetail(undefined)
    try { setDetail(await api.commitDetail(hash)) } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])

  const changeRow = (change: GitChange): ReactNode => (
    <div
      key={`${change.staged ? 's' : 'u'}:${change.path}`}
      style={{ ...rowStyle, background: selected?.path === change.path && selected.staged === change.staged ? 'var(--dsw-alias-bg-subtle, #f3f4f6)' : undefined }}
      onClick={() => { void showDiff(change.path, change.staged) }}
    >
      <span style={{ fontSize: 10, width: 14, color: 'var(--dsw-alias-text-tertiary, #6b7280)' }}>{change.status}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{change.path}</span>
      <button
        type="button"
        style={actionStyle}
        disabled={busy}
        onClick={event => {
          event.stopPropagation()
          void act(() => change.staged ? api.unstage([change.path]) : api.stage([change.path]))
        }}
      >
        {change.staged ? t('panel.unstage') : t('panel.stage')}
      </button>
    </div>
  )

  if (status !== undefined && !status.repository) {
    return <div style={{ padding: 16, color: 'var(--dsw-alias-text-tertiary, #6b7280)' }}>{t('panel.notRepository')}</div>
  }

  return (
    <div style={panel} data-zifyai-git="panel">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 6px' }}>
        <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status?.branch ?? t('panel.detached')}
          {status?.ahead !== undefined && status.ahead > 0 ? <span style={{ marginLeft: 6, color: 'var(--dsw-alias-text-tertiary, #6b7280)' }}>↑{status.ahead}</span> : null}
        </strong>
        {status?.remotes !== undefined && status.remotes.length > 1 ? (
          <select
            aria-label={t('panel.pushRemote')}
            value={pushRemote}
            onChange={event => setRemote(event.target.value)}
            style={{ fontSize: 11 }}
          >
            {status.remotes.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : null}
        {status?.hasRemote === true ? <button type="button" style={actionStyle} disabled={busy} onClick={() => { void push() }}>{t('panel.push')}</button> : null}
        <button type="button" style={actionStyle} disabled={busy} onClick={() => { void openGraph() }}>{t('panel.graph')}</button>
        <button type="button" style={actionStyle} disabled={busy} onClick={() => { setGraphText(undefined); setCommits(undefined); void refresh() }}>{t('panel.refresh')}</button>
      </div>
      {error !== undefined ? <div style={{ padding: '0 12px 6px', color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>{error}</div> : null}
      {notice !== undefined ? <div style={{ padding: '0 12px 6px', color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>{notice}</div> : null}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={sectionTitle}>{t('panel.staged')} ({staged.length})</div>
        {staged.length === 0 ? <div style={{ ...rowStyle, color: 'var(--dsw-alias-text-tertiary, #6b7280)', cursor: 'default' }}>{t('panel.empty')}</div> : staged.map(changeRow)}
        <div style={sectionTitle}>{t('panel.changed')} ({unstaged.length})</div>
        {unstaged.length === 0 ? <div style={{ ...rowStyle, color: 'var(--dsw-alias-text-tertiary, #6b7280)', cursor: 'default' }}>{t('panel.empty')}</div> : unstaged.map(changeRow)}
        {selected !== undefined ? (
          <div style={{ borderTop: '1px solid var(--dsw-alias-border-default, #d0d7de)', marginTop: 8 }}>
            <div style={sectionTitle}>{selected.path}{selected.staged ? t('panel.stagedSuffix') : ''}</div>
            <div style={{ padding: '0 12px', maxHeight: 320, overflow: 'auto' }}>
              {splitHunks(diff).map((hunk, index) => (
                <div key={`${String(index)}:${hunk.header}`} style={{ borderTop: '1px solid var(--dsw-alias-border-subtle, #eef0f2)', padding: '4px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <code style={{ flex: 1, fontSize: 10, color: 'var(--dsw-alias-text-tertiary, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hunk.header}</code>
                    <button type="button" style={actionStyle} disabled={busy} onClick={() => { void actHunks(selected.staged ? 'unstage' : 'stage', selected.path, hunk.header) }}>
                      {selected.staged ? t('panel.unstageHunk') : t('panel.stageHunk')}
                    </button>
                    {selected.staged ? null : (
                      <button type="button" style={actionStyle} disabled={busy} onClick={() => {
                        if (globalThis.confirm !== undefined && !globalThis.confirm(t('panel.discardConfirm', { path: selected.path }))) return
                        void actHunks('discard', selected.path, hunk.header)
                      }}>{t('panel.discardHunk')}</button>
                    )}
                  </div>
                  <DiffText text={hunk.body} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div style={sectionTitle}>{t('panel.commit')}</div>
        <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={message}
            placeholder={t('panel.commitPlaceholder')}
            onChange={event => setMessage(event.target.value)}
            rows={2}
            style={{ resize: 'vertical', font: 'inherit', padding: 6, borderRadius: 6, border: '1px solid var(--dsw-alias-border-default, #d0d7de)', background: 'transparent', color: 'inherit' }}
          />
          <div>
            <button type="button" style={buttonPrimary} disabled={busy || message.trim() === ''} onClick={() => { void commit() }}>
              {busy ? t('panel.working') : t('panel.commit')}
            </button>
          </div>
        </div>
        <div style={{ ...sectionTitle, display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('panel.historyTitle')}</span>
          <button type="button" style={actionStyle} onClick={() => { void loadLog() }}>{t('panel.load')}</button>
        </div>
        {graphText === undefined ? null : (
          <pre data-git-graph style={{ margin: 0, padding: '6px 12px', fontSize: 11, lineHeight: 1.4, overflow: 'auto', maxHeight: 320 }}>{graphText}</pre>
        )}
        {commits === undefined ? null : commits.map(commit => (
          <div
            key={commit.hash}
            data-commit={commit.shortHash}
            style={{ ...rowStyle, alignItems: 'baseline', background: detail?.commit.hash === commit.hash ? 'var(--dsw-alias-bg-subtle, #f3f4f6)' : undefined }}
            onClick={() => { void openCommit(commit.hash) }}
          >
            <span style={{ width: 10, color: 'var(--dsw-alias-state-business-primary, #0969da)' }}>●</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--dsw-alias-text-tertiary, #6b7280)' }}>{commit.shortHash}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{commit.subject}</span>
            {commit.refs === undefined ? null : (
              <span style={{ fontSize: 10, padding: '0 5px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-default, #d0d7de)', color: 'var(--dsw-alias-text-tertiary, #6b7280)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {commit.refs.split(',')[0]}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--dsw-alias-text-tertiary, #6b7280)' }}>{commit.author}</span>
          </div>
        ))}
        {detail === undefined ? null : (
          <div data-commit-detail style={{ borderTop: '1px solid var(--dsw-alias-border-default, #d0d7de)', marginTop: 6 }}>
            <div style={sectionTitle}>{detail.commit.shortHash} · {detail.commit.subject}</div>
            {splitPatch(detail.patch).map(file => (
              <details key={file.path} open style={{ padding: '0 12px 6px' }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, padding: '2px 0' }}>{file.path}</summary>
                <DiffText text={file.body} />
              </details>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
