/**
 * IPC channel names, kept free of any runtime dependency (no zod, no electron)
 * so `preload.ts` can import them without dragging the router's schema code into
 * the privileged preload bundle. Single source of truth for both sides.
 */

/** The single request channel. Streaming (per-run topics) is the only exception. */
export const INVOKE_CHANNEL = "apiweave:invoke"
export const CLOUD_STATUS_CHANGED_CHANNEL = "apiweave:cloud-status-changed"
export const UPDATE_STATUS_CHANGED_CHANNEL = "apiweave:update-status-changed"

export function runProgressChannel(runId: string): string {
  return `apiweave:run-progress:${runId}`
}

/**
 * Agent session transitions — one channel for every session, not one per
 * session like `runProgressChannel` above.
 *
 * Not keyed, for two reasons. The renderer subscribes once at startup, so it
 * cannot miss a session's opening events by subscribing after the launch call
 * returns — which is exactly what a per-run topic does to the first events of a
 * run. And there is nothing here to key: these events say *which* session
 * changed, and every consumer wants all of them.
 */
export const AGENT_SESSION_CHANGED_CHANNEL = "apiweave:agent-session-changed"

/**
 * The channel a session's output `MessagePort` is delivered on. The message
 * itself is only `{ sessionId }`; the port rides in the transfer list, and every
 * chunk after that skips the main process entirely.
 */
export const AGENT_OUTPUT_PORT_CHANNEL = "apiweave:agent-output-port"

/**
 * The `agents:*` invoke channels, spelled once for both halves of the bridge:
 * `main.ts` registers each of them behind the trusted-sender guard, and
 * `preload.ts` exposes each as a typed method. Keeping the wire names here
 * (rather than splicing `agents:${channel}` in one of the two) means a grep for
 * a channel name still finds both the registration and the exposure.
 */
export const AGENT_CHANNELS = {
  listRoster: "agents:listRoster",
  refreshAvailability: "agents:refreshAvailability",
  saveCustomAgent: "agents:saveCustomAgent",
  deleteCustomAgent: "agents:deleteCustomAgent",
  getDefaultAgentKey: "agents:getDefaultAgentKey",
  setDefaultAgentKey: "agents:setDefaultAgentKey",
  resolveLocalPath: "agents:resolveLocalPath",
  chooseLocalPath: "agents:chooseLocalPath",
  clearLocalPath: "agents:clearLocalPath",
  listSessions: "agents:listSessions",
  launchExternal: "agents:launchExternal",
  launchEmbedded: "agents:launchEmbedded",
  resumeSession: "agents:resumeSession",
  write: "agents:write",
  resize: "agents:resize",
  setPaused: "agents:setPaused",
  killSession: "agents:killSession",
  deleteSession: "agents:deleteSession",
  attach: "agents:attach",
} as const
