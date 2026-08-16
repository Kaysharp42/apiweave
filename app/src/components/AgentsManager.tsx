import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleStop,
  FolderOpen,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { AgentSession } from "@shared/types/AgentSession";
import { IconButton } from "./atoms/IconButton";
import { Spinner } from "./atoms/Spinner";
import { AgentSessionStatusBadge } from "./molecules/AgentSessionStatusBadge";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import { EmptyState } from "./molecules/EmptyState";
import { useAgentSessions } from "../contexts/AgentSessionsContext";
import useAgentDockStore from "../stores/AgentDockStore";
import { describeError } from "../utils/describeError";

interface AgentsManagerProps {
  readonly className?: string;
}

/**
 * The Agents section: every session in this workspace, live ones first.
 *
 * Owns the domain the way `MCPManager` owns MCP — a full-height sidebar section
 * rather than a modal, because this is where the user comes to find a session
 * again, not to configure one. Configuration is Settings → Agents; launching is
 * the canvas toolbar and the Projects list. This is the list.
 *
 * Selecting a session opens it in the terminal dock, which lives in the main
 * pane rather than in here: a 380px-wide terminal is a terminal you fight, and
 * the agent's whole reason for existing is the workflow next to it.
 */
// fallow-ignore-next-line complexity -- the section coordinates list rendering, the dock selection, and the stop/remove actions with their one shared confirmation; the row's own presentation already lives in SessionRow, and what remains is the coordination itself
export function AgentsManager({ className }: AgentsManagerProps) {
  const {
    sessions,
    busySessionIds,
    loading,
    error,
    isAvailable,
    killSession,
    removeSession,
  } = useAgentSessions();
  const openSessionId = useAgentDockStore((state) => state.openSessionId);
  const openSession = useAgentDockStore((state) => state.openSession);
  const closeDock = useAgentDockStore((state) => state.close);

  const [removeTarget, setRemoveTarget] = useState<AgentSession | null>(null);
  /**
   * Failures from the row actions, kept apart from the provider's `error`.
   *
   * That one is about the list — a read that failed, leaving every row stale.
   * This one is about the thing the user just pressed. Both land in the same
   * banner because the panel is 380px wide and there is one place at the top of
   * it a message can go, but they are cleared independently: a stop that fails
   * must not look like it was fixed by the next successful refresh.
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live first, then most recent — a running agent is the one thing in this list
  // that is asking for attention.
  const ordered = useMemo(
    () => [...sessions].sort((left, right) => rank(left) - rank(right)),
    [sessions],
  );

  /**
   * A kill can fail — the process may already be gone, or main may refuse — and
   * the earlier `void killSession(...)` turned that into an unhandled rejection
   * with a Stop button that appeared to do nothing at all. Silence is the worst
   * possible answer here: the user's next move is to press it again.
   */
  const onStop = (sessionId: string): void => {
    setActionError(null);
    void killSession(sessionId).catch((cause: unknown) => {
      if (mountedRef.current) setActionError(describeError(cause));
    });
  };

  const onConfirmRemove = (): void => {
    const target = removeTarget;
    if (target === null) return;
    setRemoveTarget(null);
    setActionError(null);
    void removeSession(target.sessionId)
      .then(() => {
        // The dock renders whichever session id it holds; a removed one leaves
        // it saying the session is no longer listed, which is a worse answer
        // than closing the panel the user just emptied.
        if (openSessionId === target.sessionId) closeDock();
      })
      .catch((cause: unknown) => {
        if (mountedRef.current) setActionError(describeError(cause));
      });
  };

  if (!isAvailable) {
    return (
      <div className={className}>
        <EmptyState
          icon={
            <Bot
              className="h-12 w-12 text-text-muted dark:text-text-muted-dark"
              strokeWidth={1.5}
            />
          }
          title="Agents need the desktop app"
          description="Coding agents run as local processes, so they are only available in the APIWeave desktop app."
        />
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 flex-col ${className ?? ""}`}>
      {error !== null && (
        <p
          className="border-b border-status-error/40 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          {error}
        </p>
      )}

      {actionError !== null && (
        <p
          className="border-b border-status-error/40 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          {actionError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && sessions.length === 0 ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={
              <TerminalSquare
                className="h-12 w-12 text-text-muted dark:text-text-muted-dark"
                strokeWidth={1.5}
              />
            }
            title="No agent sessions yet"
            description="Launch an agent from a workflow's toolbar or from the Projects list. It opens in the folder you set for that project, already able to read and run the workflow."
          />
        ) : (
          <ul>
            {ordered.map((session) => (
              <SessionRow
                key={session.sessionId}
                session={session}
                busy={busySessionIds.has(session.sessionId)}
                isOpen={session.sessionId === openSessionId}
                onOpen={() => openSession(session.sessionId)}
                onStop={() => onStop(session.sessionId)}
                onRemove={() => setRemoveTarget(session)}
              />
            ))}
          </ul>
        )}
      </div>

      {/*
        One dialog for the whole list rather than one per row: the rows are
        unbounded and the confirmation is modal, so only ever one of them can be
        on screen.
      */}
      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={onConfirmRemove}
        title="Remove session"
        message={`Remove this ${removeTarget?.agentKey ?? "agent"} session from the list? Its record and any output still held for it are deleted. Nothing in the folder it ran in is touched.`}
        confirmLabel="Remove"
        intent="error"
      />
    </div>
  );
}

interface SessionRowProps {
  readonly session: AgentSession;
  /** Whether this agent is printing right now — see `AgentSessionStatusBadge`. */
  readonly busy: boolean;
  readonly isOpen: boolean;
  readonly onOpen: () => void;
  readonly onStop: () => void;
  readonly onRemove: () => void;
}

// fallow-ignore-next-line complexity -- one row presentation per session state (live vs exited, embedded vs external); the CRAP score is the estimated-coverage artifact, not real branch depth
function SessionRow({
  session,
  busy,
  isOpen,
  onOpen,
  onStop,
  onRemove,
}: SessionRowProps) {
  const isLive = session.status === "running" || session.status === "starting";
  // An external session was handed to the user's own terminal emulator, which
  // forked and took the process with it. There is no output to show and no pid
  // to stop — showing an Open button that could only fail would be worse than
  // showing none. An exited embedded session is the opposite: it opens, and
  // the host replays whatever of its output it still retains.
  const canOpen = session.launchMode === "embedded";

  return (
    <li
      className={[
        "border-b border-border dark:border-border-dark",
        isOpen ? "bg-primary/5 dark:bg-primary-light/5" : "",
      ].join(" ")}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        {/*
          Every descendant of the button is a `<span>`. A `<div>` or a `<p>`
          inside a `<button>` is invalid — button takes phrasing content only —
          and browsers repair it by closing the button early, which silently
          drops whatever came after out of the control. The layout is unchanged:
          `flex` and `block` do the work the block elements were there for.
        */}
        <button
          type="button"
          className="min-w-0 flex-1 text-left disabled:cursor-default"
          onClick={onOpen}
          disabled={!canOpen}
          title={
            canOpen
              ? isLive
                ? "Show this session's terminal"
                : "Show this session's output"
              : session.cwd
          }
        >
          <span className="flex items-center gap-2">
            <Bot
              className="h-3.5 w-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark"
              aria-hidden="true"
            />
            <span className="font-mono text-xs text-text-primary dark:text-text-primary-dark">
              {session.agentKey}
            </span>
            {/* The second badge that used to sit here said "own terminal" for
                external sessions, back when the status beside it said
                "handed off". The status now says `detached`, and two badges
                making the same point crowd the agent's name off a 230px row. */}
            <AgentSessionStatusBadge session={session} busy={busy} />
          </span>
          {/* What the agent called the work. The only line that tells two
              sessions of the same agent in the same folder apart, which the row
              previously could not do at all — every one of them read
              "claude / F:\Work\test-backend". */}
          {session.title !== null && session.title !== undefined && (
            <span className="mt-1 block truncate text-xs text-text-secondary dark:text-text-secondary-dark">
              {session.title}
            </span>
          )}
          <span className="mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] text-text-muted dark:text-text-muted-dark">
            <FolderOpen className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{session.cwd}</span>
          </span>
          {session.error !== null && session.error !== undefined && (
            <span className="mt-1 block text-[11px] text-status-error">
              {session.error}
            </span>
          )}
        </button>

        {isLive && session.launchMode === "embedded" && (
          <IconButton
            tooltip="Stop this session"
            aria-label="Stop this session"
            size="xs"
            variant="ghost"
            onClick={onStop}
          >
            <CircleStop className="h-4 w-4" />
          </IconButton>
        )}

        {/*
          Only once the session is over. A live agent is stopped first and
          removed second — offering both at once invites the user to delete the
          record of a process that then keeps running with nothing left pointing
          at it.
        */}
        {!isLive && (
          <IconButton
            tooltip="Remove this session from the list"
            aria-label={`Remove this ${session.agentKey} session from the list`}
            size="xs"
            variant="ghost"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>
    </li>
  );
}

function rank(session: AgentSession): number {
  return session.status === "running" || session.status === "starting" ? 0 : 1;
}

export default AgentsManager;
