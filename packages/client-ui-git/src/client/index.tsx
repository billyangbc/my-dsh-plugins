/**
 * Git panel: a right-sidebar tab over the Session workspace's Git state.
 * @module @zifyai/dsh-client-ui-git/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import remote from '@zifyai/dsh-api-git/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { GitPanel } from './GitPanel.tsx'
import type { GitApi } from './GitPanel.tsx'
import { translator } from './locales.ts'

/** Client plugin name. */
export const name = 'zifyai-client-ui-git'

/** Services required before the Remote mounts. */
export const inject = ['remote', 'slots', 'sidebarRightTabs']

/** Tab type id and slot key. */
const ID = '@zifyai/dsh-client-ui-git'

/** Read the success branch of a Remote result. */
async function unwrap<T>(pending: Promise<{ readonly ok: boolean; readonly value?: T; readonly error?: Error }>): Promise<T> {
  const result = await pending
  if (result.ok !== true || result.value === undefined) throw result.error ?? new Error('remote call failed')
  return result.value
}

/**
 * Bind Remote operations for one Session.
 * @param git - mounted generated Remote namespace.
 * @param sessionId - calling Session identity.
 * @returns the panel-facing API.
 */
function apiFor(git: Context['remote']['git'], sessionId: SessionId): GitApi {
  return {
    status: signal => unwrap(git.status(sessionId, signal)),
    diff: (path, staged, signal) => unwrap(git.diff(sessionId, path, staged, signal)),
    stage: (paths, signal) => unwrap(git.stage(sessionId, paths, signal)),
    unstage: (paths, signal) => unwrap(git.unstage(sessionId, paths, signal)),
    commit: (message, signal) => unwrap(git.commit(sessionId, message, signal)),
    stageHunks: (path, headers, signal) => unwrap(git.stageHunks(sessionId, path, headers, signal)),
    unstageHunks: (path, headers, signal) => unwrap(git.unstageHunks(sessionId, path, headers, signal)),
    discardHunks: (path, headers, signal) => unwrap(git.discardHunks(sessionId, path, headers, signal)),
    push: (name, signal) => unwrap(git.push(sessionId, name, signal)),
    commitDetail: (hash, signal) => unwrap(git.commitDetail(sessionId, hash, signal)),
    graph: (limit, signal) => unwrap(git.graph(sessionId, limit, signal)),
    log: (limit, signal) => unwrap(git.log(sessionId, limit, signal)),
  }
}

/**
 * Mount the Git Remote, then register the sidebar tab and its body.
 * @param ctx - client plugin context.
 * @returns disposer that withdraws the UI and the Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const t = translator()
  const unmount = await ctx.remote.$mount(remote)
  const ui = ctx.inject(['remote.git'], scope => {
    const git = scope.remote.git
    scope.effect(() => scope.sidebarRightTabs.register({
      id: ID,
      kind: 'git',
      title: () => t('panel.title'),
      guide: [{ id: 'open', order: 30, title: () => t('panel.title'), description: () => t('panel.guide') }],
    }), 'zifyai-git: tab type')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register(
      { name: 'sidebar.right.pane.tab', key: ID, // The slot platform types Session identity as a bare string; the branded id starts here.
      inject: (sessionId: string) => ({ api: apiFor(git, sessionId as SessionId) }) },
      GitPanel,
    )), 'zifyai-git: panel body')
  })
  await ui
  return async () => {
    await ui.dispose()
    await unmount()
  }
}
