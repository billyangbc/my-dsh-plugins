/**
 * Editor panel body: workspace file list, open tabs, and a CodeMirror editor with save.
 * @module @zifyai/dsh-client-ui-editor/EditorPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { javascript } from '@codemirror/lang-javascript'
import { bracketMatching } from '@codemirror/language'
import { translator } from './locales.ts'
import { autocompletion } from '@codemirror/autocomplete'
import type { CompletionContext } from '@codemirror/autocomplete'
import { forceLinting, lintGutter, linter } from '@codemirror/lint'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Diagnostic } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import type { Extension, Text } from '@codemirror/state'
import { EditorView, highlightActiveLine, hoverTooltip, keymap, lineNumbers } from '@codemirror/view'
import type { WorkspaceWriteResult } from '@zifyai/dsh-api-workspace-mutations/types'
import type { LspCompletionItem, LspDefinitionTarget, LspDiagnostic, LspHover, LspOpenResult } from '@zifyai/dsh-api-lsp/types'

/** Workspace operations bound to one Session. */
export interface EditorApi {
  /** List direct children of a directory. */
  list: (path: string, signal?: AbortSignal) => Promise<readonly { name: string; type: 'file' | 'directory' }[]>
  /** Read a file's text, content hash, and byte length in one call. */
  read: (path: string, signal?: AbortSignal) => Promise<{ text: string; hash: string; bytes: number }>
  /** Read a file's raw bytes. */
  readBytes: (path: string, signal?: AbortSignal) => Promise<Uint8Array>
  /** Write a file guarded by the hash it was read at. */
  write: (path: string, text: string, expectedHash: string | undefined, signal?: AbortSignal) => Promise<WorkspaceWriteResult>
  /** Create a file that must not already exist. */
  create: (path: string, text: string, signal?: AbortSignal) => Promise<WorkspaceWriteResult>
  /** Remove a file or empty directory. */
  remove: (path: string, signal?: AbortSignal) => Promise<void>
  /** Rename or move an entry. */
  rename: (from: string, to: string, signal?: AbortSignal) => Promise<void>
  /** Create a directory. */
  mkdir: (path: string, signal?: AbortSignal) => Promise<void>
  /** Open a document in the language server. */
  lspOpen: (path: string, text: string, languageId: string, signal?: AbortSignal) => Promise<LspOpenResult>
  /** Replace a document's content. */
  lspChange: (id: string, text: string, signal?: AbortSignal) => Promise<readonly LspDiagnostic[]>
  /** Close a document. */
  lspClose: (id: string, signal?: AbortSignal) => Promise<void>
  /** Read latest diagnostics. */
  lspDiagnostics: (id: string, signal?: AbortSignal) => Promise<readonly LspDiagnostic[]>
  /** Read hover contents. */
  lspHover: (id: string, position: { line: number; character: number }, signal?: AbortSignal) => Promise<LspHover | undefined>
  /** Send a prompt into this Session's conversation. */
  sendToChat: (text: string) => Promise<void>
  /** Optional Git status map (path → porcelain code). */
  gitStatus?: () => Promise<Record<string, string>>
  /** Resolve the definition at a position. */
  lspDefinition: (id: string, position: { line: number; character: number }, signal?: AbortSignal) => Promise<LspDefinitionTarget | undefined>
  /** List completions at a position. */
  lspCompletion: (id: string, position: { line: number; character: number }, signal?: AbortSignal) => Promise<readonly LspCompletionItem[]>
}

/** Props supplied by the slot registration. */
export interface EditorPanelProps {
  /** Operations for the calling Session. */
  readonly api: EditorApi
}

interface OpenTab {
  readonly path: string
  readonly kind: 'text' | 'image'
  text: string
  hash: string
  dirty: boolean
  readonly languageId: string
  lspId?: string
  imageUrl?: string
}

/** Maximum text file size the editor loads. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024

/** Whether a path is a browser-renderable image. */
function isImage(path: string): boolean {
  return /\.(?:png|jpe?g|webp|gif|bmp|ico|svg)$/iu.test(path)
}

/** Parent directory of a workspace-relative path. */
function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

/** Last path segment. */
function baseOf(path: string): string {
  return path.split('/').at(-1) ?? path
}

const panelStyle: React.CSSProperties = {
  display: 'flex', height: '100%', minHeight: 0,
  font: '13px/1.45 var(--dsw-alias-font-family, system-ui, sans-serif)',
  color: 'var(--dsw-alias-text-primary, #1f2328)',
  background: 'var(--dsw-alias-bg-base, #fff)',
}
const listStyle: React.CSSProperties = {
  width: 220, flex: 'none', borderRight: '1px solid var(--dsw-alias-border-default, #d0d7de)', overflow: 'auto',
}
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, padding: '3px 10px', cursor: 'pointer' }
const buttonStyle: React.CSSProperties = {
  border: '1px solid var(--dsw-alias-border-default, #d0d7de)', background: 'transparent',
  borderRadius: 6, padding: '1px 8px', fontSize: 11, cursor: 'pointer',
  color: 'var(--dsw-alias-text-secondary, #4b5563)',
}

/** LSP language id for a file path. */
function languageIdFor(path: string): string {
  const extension = /\.([a-z0-9]+)$/iu.exec(path)?.[1]?.toLowerCase() ?? ''
  const known: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    json: 'json', md: 'markdown', py: 'python', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp',
    rs: 'rust', go: 'go', java: 'java', css: 'css', html: 'html', yml: 'yaml', yaml: 'yaml',
  }
  return known[extension] ?? 'plaintext'
}

/** Convert one LSP diagnostic into a CodeMirror diagnostic. */
function toCmDiagnostic(document: Text, diagnostic: LspDiagnostic): Diagnostic {
  const lineCount = document.lines
  const clampLine = (line: number): number => Math.min(Math.max(line, 0), lineCount - 1)
  const startLine = document.line(clampLine(diagnostic.start.line) + 1)
  const endLine = document.line(clampLine(diagnostic.end.line) + 1)
  const from = Math.min(startLine.from + Math.max(diagnostic.start.character, 0), startLine.to)
  const to = Math.min(endLine.from + Math.max(diagnostic.end.character, 0), endLine.to)
  const severity = diagnostic.severity === 1 ? 'error' as const
    : diagnostic.severity === 2 ? 'warning' as const
      : diagnostic.severity === 3 ? 'info' as const : 'hint' as const
  return { from, to: Math.max(to, from), severity, message: diagnostic.message, ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }) }
}

/** CodeMirror language extension for a path. */
function languageFor(path: string): Extension | undefined {
  if (/\.(?:md|markdown)$/iu.test(path)) return markdown()
  if (/\.(?:[cm]?[jt]sx?|json)$/iu.test(path)) return javascript({ jsx: /\.[jt]sx$/iu.test(path), typescript: /\.[cm]?tsx?$/iu.test(path) })
  return undefined
}

/**
 * Render the editor panel.
 * @param props - Session-bound workspace operations.
 * @returns the panel element.
 */
export function EditorPanel({ api }: EditorPanelProps): ReactNode {
  const t = translator()
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<readonly { name: string; type: 'file' | 'directory' }[]>([])
  const [tabs, setTabs] = useState<readonly OpenTab[]>([])
  const [active, setActive] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [preview, setPreview] = useState(false)
  const [goto, setGoto] = useState<{ path: string; line: number; character: number } | undefined>(undefined)
  const [statusMap, setStatusMap] = useState<Record<string, string>>({})
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const apiRef = useRef(api)
  apiRef.current = api
  const lspTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openFileRef = useRef<(path: string) => Promise<void>>(async () => undefined)
  // Live document text per path: a destroyed CodeMirror view must not lose unsaved edits on a tab switch.
  const docs = useRef(new Map<string, string>())

  const refresh = useCallback(async (path: string) => {
    try {
      setError(undefined)
      setEntries(await api.list(path))
      setDir(path)
      if (api.gitStatus !== undefined) setStatusMap(await api.gitStatus().catch(() => ({})))
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])

  useEffect(() => { void refresh('') }, [refresh])

  const openFile = useCallback(async (path: string) => {
    setError(undefined)
    setNotice(undefined)
    const existing = tabsRef.current.find(tab => tab.path === path)
    if (existing !== undefined) { setActive(path); return }
    try {
      const languageId = languageIdFor(path)
      if (isImage(path)) {
        const bytes = await api.readBytes(path)
        if (bytes.length > MAX_TEXT_BYTES) {
          setError(t('tooLarge', { mb: (bytes.length / 1024 / 1024).toFixed(1) }))
          return
        }
        const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]))
        setTabs(current => [...current, { path, kind: 'image', text: '', hash: '', dirty: false, languageId, imageUrl: url }])
        setActive(path)
        return
      }
      const file = await api.read(path)
      if (file.bytes > MAX_TEXT_BYTES) {
        setError(t('tooLarge', { mb: (file.bytes / 1024 / 1024).toFixed(1) }))
        return
      }
      docs.current.set(path, file.text)
      let lspId: string | undefined
      try {
        const opened = await api.lspOpen(path, file.text, languageId)
        if (opened.supported && opened.id !== '') lspId = opened.id
        if (opened.supported && !opened.settled) setNotice(t('diagnosticsPending'))
      } catch (cause: unknown) {
        // A language server that cannot start must not block editing; the editor stays usable without LSP.
        lspId = undefined
        setNotice(cause instanceof Error ? cause.message : String(cause))
      }
      setTabs(current => [...current, {
        path, kind: 'text', text: file.text, hash: file.hash, dirty: false, languageId,
        ...(lspId === undefined ? {} : { lspId }),
      }])
      setActive(path)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, t])

  openFileRef.current = openFile

  const save = useCallback(async () => {
    const path = active
    if (path === undefined) return
    const tab = tabsRef.current.find(candidate => candidate.path === path)
    const currentView = view.current
    if (tab === undefined || currentView === null) return
    try {
      const text = currentView.state.doc.toString()
      const result = await api.write(path, text, tab.hash)
      docs.current.set(path, text)
      setTabs(current => current.map(candidate => candidate.path === path ? { ...candidate, text, hash: result.hash, dirty: false } : candidate))
      setNotice(t('saved', { path }))
      setError(undefined)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [active, api, t])

  const saveRef = useRef(save)
  saveRef.current = save

  // Close every document and blob when the panel unmounts: the sidebar drops the body, not the language server.
  useEffect(() => () => {
    clearTimeout(lspTimer.current)
    const current = apiRef.current
    for (const tab of tabsRef.current) {
      if (tab.lspId !== undefined) void current.lspClose(tab.lspId).catch(() => undefined)
      if (tab.imageUrl !== undefined) URL.revokeObjectURL(tab.imageUrl)
    }
  }, [])

  // Mount one CodeMirror view for the active tab; switching tabs replaces the state.
  useEffect(() => {
    if (active === undefined || host.current === null) return
    const tab = tabsRef.current.find(candidate => candidate.path === active)
    if (tab === undefined || tab.kind === 'image') return
    const language = languageFor(active)
    const state = EditorState.create({
      doc: docs.current.get(active) ?? tab.text,
      extensions: [
        lineNumbers(), highlightActiveLine(), bracketMatching(), history(),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { void saveRef.current(); return true } },
          { key: 'F12', preventDefault: true, run: currentView => {
            const current = tabsRef.current.find(candidate => candidate.path === active)
            if (current?.lspId === undefined) return false
            const head = currentView.state.selection.main.head
            const line = currentView.state.doc.lineAt(head)
            void apiRef.current.lspDefinition(current.lspId, { line: line.number - 1, character: head - line.from })
              .then(target => {
                if (target === undefined) return
                setGoto({ path: target.path, line: target.position.line, character: target.position.character })
                void openFileRef.current(target.path)
              })
              .catch(() => undefined)
            return true
          } },
          ...defaultKeymap, ...historyKeymap,
        ]),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return
          const doc = update.state.doc.toString()
          docs.current.set(active, doc)
          // Compare against the tab's saved text, not a value captured when this view mounted.
          const saved = tabsRef.current.find(candidate => candidate.path === active)
          if (saved === undefined) return
          const changed = doc !== saved.text
          setTabs(current => current.map(candidate => candidate.path === active && candidate.dirty !== changed ? { ...candidate, dirty: changed } : candidate))
          if (saved.lspId !== undefined) {
            const lspId = saved.lspId
            clearTimeout(lspTimer.current)
            lspTimer.current = setTimeout(() => {
              void apiRef.current.lspChange(lspId, doc)
                .then(() => { if (view.current !== null) forceLinting(view.current) })
                .catch(() => undefined)
            }, 700)
          }
        }),
        lintGutter(),
        linter(async (currentView) => {
          const current = tabsRef.current.find(candidate => candidate.path === active)
          if (current?.lspId === undefined) return []
          const diagnostics = await apiRef.current.lspDiagnostics(current.lspId).catch(() => [])
          return diagnostics.map(diagnostic => toCmDiagnostic(currentView.state.doc, diagnostic))
        }),
        autocompletion({
          override: [async (context: CompletionContext) => {
            const current = tabsRef.current.find(candidate => candidate.path === active)
            if (current?.lspId === undefined) return null
            const line = context.state.doc.lineAt(context.pos)
            const items = await apiRef.current.lspCompletion(current.lspId, {
              line: line.number - 1, character: context.pos - line.from,
            }).catch(() => [])
            if (items.length === 0) return null
            const word = context.matchBefore(/[\w$]*/u)
            return {
              from: word?.from ?? context.pos,
              options: items.map(item => ({
                label: item.label,
                ...(item.detail === undefined ? {} : { detail: item.detail }),
                ...(item.kind === undefined ? {} : { type: item.kind }),
              })),
            }
          }],
        }),
        hoverTooltip(async (currentView, position) => {
          const current = tabsRef.current.find(candidate => candidate.path === active)
          if (current?.lspId === undefined) return null
          const line = currentView.state.doc.lineAt(position)
          const hover = await apiRef.current.lspHover(current.lspId, { line: line.number - 1, character: position - line.from }).catch(() => undefined)
          if (hover === undefined) return null
          return { pos: position, end: position, above: true, create: () => ({ dom: Object.assign(document.createElement('div'), { textContent: hover.contents }) }) }
        }),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { fontFamily: 'var(--dsw-alias-font-mono, monospace)' } }),
        ...(language === undefined ? [] : [language]),
      ],
    })
    const instance = new EditorView({ state, parent: host.current })
    view.current = instance
    if (goto?.path === active) {
      const line = instance.state.doc.line(Math.min(goto.line + 1, instance.state.doc.lines))
      const anchor = Math.min(line.from + goto.character, line.to)
      instance.dispatch({ selection: { anchor }, scrollIntoView: true })
      setGoto(undefined)
    }
    return () => {
      instance.destroy()
      view.current = null
    }
  }, [active, goto])

  useEffect(() => { setPreview(false) }, [active])

  const closeTab = useCallback((path: string) => {
    const closing = tabsRef.current.find(tab => tab.path === path)
    if (closing?.dirty === true && globalThis.confirm !== undefined && !globalThis.confirm(t('closeConfirm', { path }))) return
    if (closing?.lspId !== undefined) void api.lspClose(closing.lspId).catch(() => undefined)
    if (closing?.imageUrl !== undefined) URL.revokeObjectURL(closing.imageUrl)
    docs.current.delete(path)
    setTabs(current => current.filter(tab => tab.path !== path))
    setActive(current => current === path ? tabsRef.current.find(tab => tab.path !== path)?.path : current)
  }, [api, t])

  const createEntry = useCallback(async (kind: 'file' | 'directory') => {
    const name = globalThis.prompt?.(kind === 'file' ? t('newFileName') : t('newFolderName'))
    if (name === null || name.trim() === '') return
    const path = dir === '' ? name.trim() : `${dir}/${name.trim()}`
    try {
      if (kind === 'file') {
        await api.create(path, '')
        await refresh(dir)
        await openFile(path)
      } else {
        await api.mkdir(path)
        await refresh(dir)
      }
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [api, dir, openFile, refresh, t])

  const renameActive = useCallback(async () => {
    const tab = tabsRef.current.find(candidate => candidate.path === active)
    if (tab === undefined) return
    const name = globalThis.prompt?.(t('renamePrompt'), baseOf(tab.path))
    if (name === null || name.trim() === '') return
    const target = parentOf(tab.path) === '' ? name.trim() : `${parentOf(tab.path)}/${name.trim()}`
    try {
      await api.rename(tab.path, target)
      closeTab(tab.path)
      await refresh(dir)
      await openFile(target)
      setNotice(t('renamed', { path: target }))
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [active, api, closeTab, dir, openFile, refresh, t])

  const deleteActive = useCallback(async () => {
    const tab = tabsRef.current.find(candidate => candidate.path === active)
    if (tab === undefined) return
    if (globalThis.confirm !== undefined && !globalThis.confirm(t('deleteConfirm', { path: tab.path }))) return
    try {
      await api.remove(tab.path)
      closeTab(tab.path)
      await refresh(dir)
      setNotice(t('deleted', { path: tab.path }))
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }, [active, api, closeTab, dir, refresh, t])

  const breadcrumb = useMemo(() => dir === '' ? t('workspace') : dir.split('/').join(' / '), [dir, t])

  const activeTab = tabs.find(tab => tab.path === active)

  return (
    <div style={panelStyle} data-zifyai-editor="panel">
      <div style={listStyle}>
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px', alignItems: 'center' }}>
          <strong style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{breadcrumb}</strong>
          <button type="button" style={buttonStyle} onClick={() => { void createEntry('file') }}>{t('newFile')}</button>
          <button type="button" style={buttonStyle} onClick={() => { void createEntry('directory') }}>{t('newFolder')}</button>
          <button type="button" style={buttonStyle} onClick={() => { void refresh(dir) }}>{t('refresh')}</button>
        </div>
        {dir === '' ? null : (
          <div style={rowStyle} onClick={() => { void refresh(parentOf(dir)) }}>
            <span>..</span>
          </div>
        )}
        {entries.map(entry => {
          const path = dir === '' ? entry.name : `${dir}/${entry.name}`
          return (
          <div
            key={entry.name}
            style={{ ...rowStyle, background: active === path ? 'var(--dsw-alias-bg-subtle, #f3f4f6)' : undefined }}
            onClick={() => {
              if (entry.type === 'directory') void refresh(path)
              else void openFile(path)
            }}
          >
            <span style={{ color: 'var(--dsw-alias-text-tertiary, #6b7280)', width: 12 }}>{entry.type === 'directory' ? '▸' : '·'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{entry.name}</span>
            {statusMap[path] === undefined ? null : <span style={{ color: 'var(--dsw-alias-state-business-primary, #0969da)', fontSize: 10 }}>{statusMap[path]}</span>}
          </div>
          )
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-default, #d0d7de)', padding: '4px 6px', overflowX: 'auto' }}>
          {tabs.map(tab => (
            <span
              key={tab.path}
              onClick={() => setActive(tab.path)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                background: active === tab.path ? 'var(--dsw-alias-bg-subtle, #f3f4f6)' : undefined,
              }}
            >
              {tab.dirty ? '● ' : ''}{baseOf(tab.path)}
              <button type="button" aria-label={t('closeTab', { path: tab.path })} style={{ ...buttonStyle, border: 'none', padding: '0 2px' }} onClick={event => { event.stopPropagation(); closeTab(tab.path) }}>×</button>
            </span>
          ))}
          <span style={{ flex: 1 }} />
          {active !== undefined && /\.(?:md|markdown)$/iu.test(active) ? (
            <button type="button" style={buttonStyle} onClick={() => {
              screenText()
              setPreview(current => !current)
            }}>{preview ? t('edit') : t('preview')}</button>
          ) : null}
          {activeTab !== undefined && activeTab.kind === 'text' ? (
            <button type="button" style={buttonStyle} onClick={() => {
              const currentView = view.current
              const tab = tabsRef.current.find(candidate => candidate.path === active)
              if (tab === undefined) return
              const selection = currentView === null ? '' : currentView.state.sliceDoc(currentView.state.selection.main.from, currentView.state.selection.main.to)
              const line = currentView === null ? 1 : currentView.state.doc.lineAt(currentView.state.selection.main.head).number
              const text = selection.trim() === ''
                ? t('sendContext', { path: tab.path })
                : t('sendSelection', { path: tab.path, line, quote: selection.replace(/\n/gu, '\n> ') })
              void api.sendToChat(text).then(() => setNotice(t('sent'))).catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : String(cause))
              })
            }}>{t('send')}</button>
          ) : null}
          {active === undefined ? null : <button type="button" style={buttonStyle} disabled={!activeTab?.dirty} onClick={() => { void save() }}>{t('save')}</button>}
          {active === undefined ? null : <button type="button" style={buttonStyle} onClick={() => { void renameActive() }}>{t('rename')}</button>}
          {active === undefined ? null : <button type="button" style={buttonStyle} onClick={() => { void deleteActive() }}>{t('remove')}</button>}
        </div>
        {error !== undefined ? <div style={{ padding: '4px 10px', color: 'var(--dsw-alias-state-error-primary, #b42318)' }}>{error}</div> : null}
        {notice !== undefined ? <div style={{ padding: '4px 10px', color: 'var(--dsw-alias-state-success-primary, #15803d)' }}>{notice}</div> : null}
        {activeTab?.kind === 'image' ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
            <img src={activeTab.imageUrl} alt={active} style={{ maxWidth: '100%' }} />
          </div>
        ) : preview && active !== undefined && /\.(?:md|markdown)$/iu.test(active) ? (
          <div
            data-zifyai-markdown-preview
            style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px 16px' }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(activeTab?.text ?? '') as string) }}
          />
        ) : (
          <div ref={host} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
        )}
        {active === undefined ? <div style={{ padding: 16, color: 'var(--dsw-alias-text-tertiary, #6b7280)' }}>{t('empty')}</div> : null}
      </div>
    </div>
  )

  /** Copy the live document text into tab state before rendering Markdown from it. */
  function screenText(): void {
    if (active === undefined || view.current === null) return
    const text = view.current.state.doc.toString()
    docs.current.set(active, text)
    setTabs(current => current.map(candidate => candidate.path === active ? { ...candidate, text } : candidate))
  }
}
