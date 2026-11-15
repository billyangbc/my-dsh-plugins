/**
 * Mermaid fence layer for the Chat flow: draws `mermaid` code fences as diagrams
 * with an optional full-screen zoom/pan view.
 * @module @zifyai/dsh-client-ui-mermaid
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MermaidFence } from './MermaidFence.tsx'

/** Client plugin name. */
export const name = 'zifyai-client-ui-mermaid'

/** The fence layer registers into the slot registry declared by ui-chat. */
export const inject = ['slots']

/**
 * Register the fence layer; the layer only claims fences whose language is `mermaid`.
 * The slot is declared by ui-chat, so registration waits for that declaration
 * instead of failing when this bundle activates first.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.slots.inject('conversation.chat.markdown.fence', () => ctx.slots.register(
      { name: 'conversation.chat.markdown.fence', id: '@zifyai/dsh-client-ui-mermaid', key: 'mermaid', order: 10 },
      MermaidFence,
    )),
    'mermaid: chat fence layer',
  )
}
