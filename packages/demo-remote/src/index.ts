/**
 * Minimal out-of-tree Typert Remote used to prove the plugin build path.
 * @module @zifyai/dsh-demo-remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/cordis' {
  interface Context {
    demo: DemoRemote
  }
}

/**
 * One in-memory namespace that echoes caller text.
 */
export default class DemoRemote extends TypertRemoteService {
  /**
   * @param ctx - owning Host context.
   */
  constructor(ctx: Context) {
    super(ctx, 'demo')
  }

  /**
   * Echo text back with a fixed prefix.
   * @param text - caller text.
   * @returns the prefixed text.
   */
  @Remote('echo')
  echoForClient(text: string): string {
    return `echo:${text}`
  }
}
