/**
 * Node-side loader entry for the editor panel; the browser half lives in `./client`.
 * @module @zifyai/dsh-client-ui-editor
 */

/** Plugin name shared by both halves. */
export const name = 'zifyai-client-ui-editor'

/** Host half contributes nothing; the browser half hosts the editor. */
export function apply(): void {}
