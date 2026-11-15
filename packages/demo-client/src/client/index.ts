/**
 * Browser half of the P2 proof: mount the out-of-tree Remote and call it.
 * @module @zifyai/dsh-demo-client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import remote from '@zifyai/dsh-demo-remote/remote'

/** Client plugin name reported by the Loader. */
export const name = 'zifyai-demo-client'

/** Wait for the Remote carrier before mounting. */
export const inject = ['remote']

/**
 * Mount the generated Remote contribution, call `echo`, and publish the outcome.
 * @param ctx - client plugin context.
 * @returns disposer that unmounts the Remote and removes the marker.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(remote)
  let banner: HTMLElement | undefined
  const ui = ctx.inject(['remote.demo'], async (scope) => {
    let outcome: unknown
    try {
      outcome = await scope.remote.demo.echo('p2')
    } catch (error: unknown) {
      outcome = { threw: error instanceof Error ? error.message : String(error) }
    }
    ;(globalThis as Record<string, unknown>).__DSH_P2_DEMO__ = outcome
    banner = document.createElement('div')
    banner.id = 'p2-demo-banner'
    banner.dataset.result = JSON.stringify(outcome)
    banner.textContent = `P2 demo ${JSON.stringify(outcome)}`
    banner.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:4px 8px;border-radius:6px;background:#0b7285;color:#fff;font:12px/1.4 monospace'
    document.body.appendChild(banner)
  })
  await ui
  return async () => {
    banner?.remove()
    await ui.dispose()
    await unmount()
  }
}
