import type { PtySpawnRequest } from "./pty_protocol"

/**
 * The embedded-terminal backend, as {@link AgentService} sees it.
 *
 * An interface rather than a direct dependency for the same reason the service
 * takes `pickDirectory` and `getMcpConfig` injected: everything that actually
 * runs a process lives in `electron/`, and a service that imported it could not
 * be tested without an Electron runtime. `AgentProcessManager` satisfies this
 * structurally.
 *
 * Note what is missing: `attach`. Handing the renderer an output port means
 * transferring a `MessagePortMain`, which is an Electron object the service has
 * no business holding. The service authorizes the session and the composition
 * root moves the port — see `AgentService.authorizeSessionRead`.
 */
export interface PtyLauncher {
  /** Resolves the child's pid, or rejects with a message fit to show the user. */
  readonly start: (request: PtySpawnRequest) => Promise<number>
  readonly write: (sessionId: string, data: string) => void
  readonly resize: (sessionId: string, cols: number, rows: number) => void
  readonly setPaused: (sessionId: string, paused: boolean) => void
  readonly kill: (sessionId: string) => void
  /**
   * Whether `attach` can hand over a port: a running process, or an exited one
   * whose replay the host still retains. Live is not enough on its own — an
   * ended session the user reopens gets its scrollback, not a dead terminal.
   */
  readonly canAttach: (sessionId: string) => boolean
}
