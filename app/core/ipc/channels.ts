/**
 * IPC channel names, kept free of any runtime dependency (no zod, no electron)
 * so `preload.ts` can import them without dragging the router's schema code into
 * the privileged preload bundle. Single source of truth for both sides.
 */

/** The single request channel. Streaming (per-run topics) is the only exception. */
export const INVOKE_CHANNEL = "apiweave:invoke"
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
 * OAuth 2.0 sign-in for HTTP nodes. Privileged and off the router, like
 * `AGENT_CHANNELS`: it opens the system browser and writes the secret store.
 */
export const OAUTH_CHANNELS = {
  authorize: "oauth:authorize",
  status: "oauth:status",
  clear: "oauth:clear",
} as const

/**
 * Settings > Network. Privileged and off the router like `OAUTH_CHANNELS`: it
 * decides where every request goes and which servers are trusted, and makes
 * main read files from disk — no local agent may reach it over MCP.
 */
export const NETWORK_CHANNELS = {
  get: "network:get",
  save: "network:save",
  chooseFile: "network:chooseFile",
} as const

/**
 * A workspace's version history in git. Privileged and off the router like
 * `NETWORK_CHANNELS`, so no local agent can reach it over MCP: main runs
 * git and writes files, and whoever can call `connectRemote` decides where a
 * workspace is pushed.
 */
export const GIT_CHANNELS = {
  status: "git:status",
  statusAll: "git:statusAll",
  track: "git:track",
  untrack: "git:untrack",
  setMode: "git:setMode",
  syncNow: "git:syncNow",
  pendingChanges: "git:pendingChanges",
  mergeConflicts: "git:mergeConflicts",
  mergePicks: "git:mergePicks",
  mergeRecordCommits: "git:mergeRecordCommits",
  resolveMerge: "git:resolveMerge",
  abandonMerge: "git:abandonMerge",
  connectRemote: "git:connectRemote",
  disconnectRemote: "git:disconnectRemote",
  discardLocalChanges: "git:discardLocalChanges",
  openFromGit: "git:openFromGit",
  listAccounts: "git:listAccounts",
  setAccount: "git:setAccount",
  signIn: "git:signIn",
  cancelSignIn: "git:cancelSignIn",
  openSignInPage: "git:openSignInPage",
  listOwners: "git:listOwners",
  createRepository: "git:createRepository",
} as const

/** The one-time code a sign-in in progress printed, pushed to the renderer for its dialog. */
export const GIT_SIGN_IN_PROMPT_CHANNEL = "apiweave:git-sign-in-prompt"

/** Every status `GIT_CHANNELS` calls and auto commits leave behind, pushed to the renderer. */
export const GIT_STATUS_CHANGED_CHANNEL = "apiweave:git-status-changed"

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
 * A project run's record changed — carries the whole `ProjectRun`, which is
 * small and holds ids and statuses only. Unkeyed for the same reason as
 * {@link RUN_STARTED_CHANNEL}: an agent can start a project run the renderer
 * never asked for, and the project page should still show it.
 */
export const PROJECT_RUN_CHANGED_CHANNEL = "apiweave:project-run-changed"

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
 * cheaper than the bookkeeping needed to prove it did. The renderer's own
 * writes are never published: they already update its stores, and announcing
 * them would fight its optimistic updates.
 *
 * Besides MCP writes there is one publisher: a workspace's import from its git
 * remote rewrites records underneath the renderer the same way, and announces
 * action `gitImport` once per domain the workspace's tree holds.
 */
export const AGENT_WRITE_CHANNEL = "apiweave:agent-write"

/**
 * Argv marker main passes to the renderer when the OS reports assistive
 * technology. Not a channel, but it lives here for the same reason the channels
 * do: main writes it, preload reads it, and a typo would be silent on both
 * sides.
 *
 * It rides on `additionalArguments` rather than an IPC call because the one
 * consumer — xterm's screen-reader tree — has to decide before its first frame,
 * and a promise resolving after mount would mean rebuilding the terminal.
 */
export const SCREEN_READER_ARG = "--apiweave-screen-reader"

/**
 * The quit handshake, on the window bridge rather than the router so no local
 * agent can drive it. Main asks the renderer before the window closes or the
 * app quits; the renderer acks at once (so main can tell a live page from a
 * hung one), settles its unsaved canvas — possibly by asking the user — and
 * replies whether the close may go ahead.
 */
export const WINDOW_CLOSE_REQUEST_CHANNEL = "window:closeRequest"
export const WINDOW_CLOSE_ACK_CHANNEL = "window:closeAck"
export const WINDOW_CLOSE_REPLY_CHANNEL = "window:closeReply"
