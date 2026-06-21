/**
 * deplao-ui/lib/ipc.ts - Web shim replacing the Electron IPC wrapper.
 * Re-exports the REST/Socket.io web adapter so desktop components get the
 * web implementation transparently.
 */
export { ipc, emitIpcEvent } from '../../lib/ipc'
export { default } from '../../lib/ipc'
