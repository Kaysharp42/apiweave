import type { AgentSession } from "@shared/types/AgentSession";

/**
 * Note what is absent: launching. A launch needs no shared state and produces an
 * `agent.started` event that refreshes every consumer anyway, so it goes through
 * the client directly — which also keeps the launch control usable in a tree that
 * has no provider above it.
 */
export interface AgentSessionsContextValue {
  /** Newest first, as the repository returns them. */
  readonly sessions: readonly AgentSession[];
  /**
   * Sessions whose agent is printing right now — the difference between an
   * agent working and one waiting at its prompt, which `status` cannot express
   * because both are a live process.
   *
   * Separate from `sessions` rather than a field on the row, because it is not
   * on the row: it is never persisted, so a session missing from this set is
   * "not currently printing", never "unknown".
   */
  readonly busySessionIds: ReadonlySet<string>;
  /** True until the first list has arrived, so an empty list is not shown as "none". */
  readonly loading: boolean;
  readonly error: string | null;
  /** False outside the desktop shell, where there is no process to launch. */
  readonly isAvailable: boolean;
  readonly refresh: () => Promise<void>;
  /**
   * Rejects, and is meant to: a kill can fail because the session is already
   * gone or because main refuses it, and both are things the user has to be
   * told — a Stop button that silently does nothing is the worse failure. Call
   * sites must attach a `.catch` and show it; `void killSession(...)` turns a
   * rejection into an unhandled one.
   */
  readonly killSession: (sessionId: string) => Promise<void>;
  /**
   * Forget a session's record and re-read the list. Rejects on the same terms
   * as `killSession`, and for the same reason.
   */
  readonly removeSession: (sessionId: string) => Promise<void>;
  /**
   * Run a finished session's conversation again, in place. Resolves to the
   * session's id — the same one that was passed in, since a resume keeps the row
   * rather than adding another.
   *
   * Rejects on the same terms as the other two — and here it matters most: this
   * one starts a process, and the reasons it can refuse (no recorded
   * conversation id, an agent that cannot resume, a folder that has since
   * moved) are all things the user has to be told rather than left guessing at.
   */
  readonly resumeSession: (
    sessionId: string,
    cols: number,
    rows: number,
  ) => Promise<string>;
}
