/**
 * Node-side loader entry for the Git panel; the browser half lives in `./client`.
 * @module @zifyai/dsh-client-ui-git
 */

/** Plugin name shared by both halves. */
export const name = 'zifyai-client-ui-git'

/** Host half contributes nothing; the browser half draws the panel. */
export function apply(): void {}
