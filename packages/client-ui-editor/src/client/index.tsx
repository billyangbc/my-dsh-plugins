/**
 * Editor panel: a right-sidebar tab with a workspace file list and CodeMirror editor.
 * @module @zifyai/dsh-client-ui-editor/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import mutations from '@zifyai/dsh-api-workspace-mutations/remote'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import lspRemote from '@zifyai/dsh-api-lsp/remote'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { EditorPanel } from './EditorPanel.tsx'
import type { EditorApi } from './EditorPanel.tsx'
import { translator } from './locales.ts'

/** Client plugin name. */
export const name = 'zifyai-client-ui-editor'

/** Services required before mounting: Remote carrier, slots, the sidebar registry, and the session store. */
export const inject = ['remote', 'slots', 'sidebarRightTabs', 'sessions']

const ID = '@zifyai/dsh-client-ui-editor'

/**
 * The subset of the Client session store the editor uses. The provider
 * (`dsh-api-session-controller/client`) registers it through `reflect.provide`,
 * so it carries no declaration of its own; this one states the surface in use.
 */
interface ClientSessionStore {
  /** A Session-scoped Context, or undefined when the Session is not loaded. */
  scope: (sessionId: SessionId) => Context | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client session store provided by the session-controller's client half. */
    sessions: ClientSessionStore
  }
}

/** The conversation surface the editor forwards selections to. */
interface ConversationScope {
  send: (text: string) => Promise<void>
}

/** A Remote result the generated namespace returns. */
type Result<T> = Promise<{ readonly ok: boolean; readonly value?: T; readonly error?: Error }>

/**
 * The subset of the optional Git Remote the editor reads. The Git bundle can be
 * absent, so the editor keeps a local shape instead of importing its Remote types.
 */
interface OptionalGitRemote {
  status: (sessionId: SessionId) => Promise<{ readonly ok: boolean; readonly value?: { readonly changes?: ReadonlyArray<{ readonly path: string; readonly status: string }> } }>
}

/** Read the success branch of a Remote result. */
async function unwrap<T>(pending: Result<T>): Promise<T> {
  const result = await pending
  if (result.ok !== true || result.value === undefined) throw result.error ?? new Error('remote call failed')
  return result.value
}

/** Await a Remote result that carries no value. */
async function voidCall(pending: Result<unknown>): Promise<void> {
  const result = await pending
  if (result.ok !== true) throw result.error ?? new Error('remote call failed')
}

/** SHA-256 hex digest of a byte array. */
async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Bind editor operations for one Session to the mounted Remote namespaces.
 * @param ctx - Client plugin Context holding the session store.
 * @param remote - the mounted Remote namespaces this panel calls.
 * @param sessionId - calling Session identity.
 * @returns the panel-facing API.
 */
function apiFor(ctx: Context, remote: Context['remote'], sessionId: SessionId): EditorApi {
  const files = remote.workspaceFiles
  const edit = remote.workspaceEdit
  const lsp = remote.lsp
  const conversation = (): ConversationScope | undefined =>
    ctx.sessions.scope(sessionId)?.get('conversation') as ConversationScope | undefined
  const gitStatus = async (): Promise<Record<string, string>> => {
    // The Git bundle is optional: without it the namespace is simply not mounted.
    const git = (remote as unknown as { git?: OptionalGitRemote }).git
    if (git === undefined) return {}
    const result = await git.status(sessionId)
    if (result.ok !== true || result.value?.changes === undefined) return {}
    const statuses: Record<string, string> = {}
    for (const change of result.value.changes) statuses[change.path] = change.status
    return statuses
  }
  return {
    list: async (path, signal) => {
      const listing = await unwrap(files.list(sessionId, path === '' ? '.' : path, signal))
      // The upstream listing also reports 'other'; the panel only distinguishes directories from files.
      return listing.entries.map(entry => ({
        name: entry.name,
        type: entry.type === 'directory' ? 'directory' as const : 'file' as const,
      }))
    },
    // One read serves both the size guard, the hash, and the text: two reads could straddle an external write.
    read: async (path, signal) => {
      const bytes = (await unwrap(files.readBytes(sessionId, path, {}, signal))).data
      const text = new TextDecoder().decode(bytes as Uint8Array<ArrayBuffer>)
      return { text, hash: await sha256(bytes as Uint8Array<ArrayBuffer>), bytes: bytes.length }
    },
    readBytes: async (path, signal) => (await unwrap(files.readBytes(sessionId, path, {}, signal))).data,
    write: (path, text, expectedHash, signal) => unwrap(edit.write(sessionId, path, text, expectedHash, signal)),
    create: (path, text, signal) => unwrap(edit.createFile(sessionId, path, text, signal)),
    remove: async (path, signal) => { await voidCall(edit.deleteFile(sessionId, path, signal)) },
    rename: async (from, to, signal) => { await voidCall(edit.moveFile(sessionId, from, to, signal)) },
    mkdir: async (path, signal) => { await voidCall(edit.mkdir(sessionId, path, signal)) },
    lspOpen: (path, text, languageId, signal) => unwrap(lsp.open(sessionId, path, text, languageId, signal)),
    lspChange: (id, text, signal) => unwrap(lsp.change(sessionId, id, text, signal)),
    lspClose: async (id, signal) => { await voidCall(lsp.close(sessionId, id, signal)) },
    lspDiagnostics: (id, signal) => unwrap(lsp.diagnostics(sessionId, id, signal)),
    lspHover: (id, position, signal) => unwrap(lsp.hover(sessionId, id, position, signal)),
    sendToChat: async (text) => {
      const scoped = conversation()
      if (scoped === undefined) throw new Error('conversation service is unavailable for this session')
      await scoped.send(text)
    },
    gitStatus,
    lspDefinition: (id, position, signal) => unwrap(lsp.definition(sessionId, id, position, signal)),
    lspCompletion: (id, position, signal) => unwrap(lsp.completion(sessionId, id, position, signal)),
  }
}

/**
 * Mount the mutation Remotes, then register the editor tab.
 * @param ctx - client plugin context.
 * @returns disposer that withdraws the UI and the Remotes.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const t = translator()
  const unmountMutations = await ctx.remote.$mount(mutations)
  const unmountLsp = await ctx.remote.$mount(lspRemote)
  const ui = ctx.inject(['remote.workspaceEdit', 'remote.workspaceFiles', 'remote.lsp'], scope => {
    const remote = scope.remote
    scope.effect(() => scope.sidebarRightTabs.register({
      id: ID,
      kind: 'editor',
      title: () => t('title'),
      guide: [{ id: 'open', order: 20, title: () => t('title'), description: () => t('guide') }],
    }), 'zifyai-editor: tab type')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register(
      { name: 'sidebar.right.pane.tab', key: ID, // The slot platform types Session identity as a bare string; the branded id starts here.
      inject: (sessionId: string) => ({ api: apiFor(scope, remote, sessionId as SessionId) }) },
      EditorPanel,
    )), 'zifyai-editor: panel body')
  })
  await ui
  return async () => {
    await ui.dispose()
    await unmountLsp()
    await unmountMutations()
  }
}
