/**
 * Node-side loader entry for the demo client plugin; the browser half lives in `./client`.
 * @module @zifyai/dsh-demo-client
 */

/** Plugin name shared by both halves. */
export const name = 'zifyai-demo-client'

/** Host half contributes nothing; the browser half is loaded separately. */
export function apply(): void {}
