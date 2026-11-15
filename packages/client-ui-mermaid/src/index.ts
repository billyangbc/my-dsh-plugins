/**
 * Node-side loader entry for the Mermaid plugin; the browser half lives in `./client`.
 * @module @zifyai/dsh-client-ui-mermaid
 */

/** Plugin name shared by both halves. */
export const name = 'zifyai-client-ui-mermaid'

/** Host half contributes nothing; the browser half draws fences. */
export function apply(): void {}
