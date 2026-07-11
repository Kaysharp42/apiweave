/**
 * Tiny event emitter for cloud sync state. Holds the current state and
 * notifies subscribers on change. No tokens, no payloads — only the state
 * label is emitted to the renderer via IPC.
 */

import type { SyncState } from "./cloud-transport"

export type SyncStateListener = (state: SyncState) => void

let currentState: SyncState = "idle"
const listeners = new Set<SyncStateListener>()

export function getState(): SyncState {
  return currentState
}

export function setState(state: SyncState): void {
  if (state === currentState) return
  currentState = state
  for (const listener of listeners) {
    listener(state)
  }
}

export function subscribe(listener: SyncStateListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Reset to idle and clear all listeners. For tests only. */
export function resetState(): void {
  currentState = "idle"
  listeners.clear()
}
