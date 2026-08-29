/**
 * IPC channel names, kept free of any runtime dependency (no zod, no electron)
 * so `preload.ts` can import them without dragging the router's schema code into
 * the privileged preload bundle. Single source of truth for both sides.
 */

/** The single request channel. Streaming (per-run topics) is the only exception. */
export const INVOKE_CHANNEL = "apiweave:invoke"
export const CLOUD_STATUS_CHANGED_CHANNEL = "apiweave:cloud-status-changed"
export const UPDATE_STATUS_CHANGED_CHANNEL = "apiweave:update-status-changed"
export const WORKFLOW_CHANGED_CHANNEL = "apiweave:workflow-changed"

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

/**
 * A run began — broadcast for EVERY run, whoever started it (the canvas's own
 * Run button, or an agent through the MCP `runs_create` tool).
 *
 * Unkeyed, for the reason spelled out above {@link AGENT_SESSION_CHANGED_CHANNEL}
 * and made concrete by {@link runProgressChannel}: a per-run topic cannot be
 * subscribed to before the runId exists, and the runId only exists once someone
 * has called `runs.create` — so a run the renderer did not start is a run it can
 * never hear about. This channel is what carries the runId to a listener that
 * has been subscribed since startup.
 *
 * Carries the workflow identity that {@link RunEvent} does not: `run.started`
 * knows only its runId, and a canvas has to decide whether the run is one it
 * should be showing before it can subscribe to anything.
 */
export const RUN_STARTED_CHANNEL = "apiweave:run-started"

/**
 * An MCP write landed — one channel for every domain, carrying only what
 * changed in the broadest terms: `{domain, action}` plus the `workspaceId` the
 * call named, when it named one.
 *
 * Why this exists at all: only `WorkflowRepository` has a change observer (see
 * {@link WORKFLOW_CHANGED_CHANNEL}), so a workspace, project, environment or
 * node preset an agent writes over MCP changes underneath a renderer that has
 * no way to hear about it and no polling to catch it — the lists only refetch
 * on window focus. Rather than grow an observer, a channel and a listener per
 * repository, this announces the *fact* of an agent write and lets the renderer
 * refetch through the paths it already uses when the window regains focus.
 *
 * Unkeyed and coarse deliberately: the renderer is refetching a handful of
 * local SQLite lists, so an occasional refetch it did not strictly need is far
 * cheaper than the bookkeeping needed to prove it did. Only MCP writes are
 * published — the renderer's own writes already update its stores, and
 * announcing those would fight its optimistic updates.
 */
export const AGENT_WRITE_CHANNEL = "apiweave:agent-write"
