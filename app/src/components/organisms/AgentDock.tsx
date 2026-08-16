import { useEffect, useRef, useState } from "react";
import { CircleStop, RotateCcw, Terminal, X } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { AgentSessionStatusBadge } from "../molecules/AgentSessionStatusBadge";
import { useAgentSessions } from "../../contexts/AgentSessionsContext";
import useAgentDockStore from "../../stores/AgentDockStore";
import { describeError } from "../../utils/describeError";
import { AgentTerminal } from "./AgentTerminal";

/**
 * The agent, in its own column beside the canvas it is editing.
 *
 * A column and not a page, because the entire argument for wiring MCP into the
 * launch is that the agent edits the workflow while you watch it happen — a
 * terminal that replaced the canvas would throw that away. Sitting on the left,
 * between the sidebar and the workspace, it continues the layout's existing
 * rail → list → content progression instead of reading as a tray bolted
 * underneath it.
 *
 * A tall, narrow frame also suits the content better than a wide short one: the
 * agent's output is a transcript, and a transcript wants lines, not columns.
 *
 * Everything around the terminal is ordinary app chrome: hairline borders, near
 * flat, and session state as a badge with a glyph rather than a coloured dot.
 * Inside the frame is the one place in the app where sixteen colours are not
 * APIWeave's to choose.
 */
export function AgentDock() {
  const openSessionId = useAgentDockStore((state) => state.openSessionId);
  const openSession = useAgentDockStore((state) => state.openSession);
  const focusRequest = useAgentDockStore((state) => state.focusRequest);
  const close = useAgentDockStore((state) => state.close);
  const { sessions, busySessionIds, killSession, resumeSession } =
    useAgentSessions();
  const [stopError, setStopError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const session = sessions.find((row) => row.sessionId === openSessionId);
  const isLive = session?.status === "running" || session?.status === "starting";
  // Stopping is only meaningful for a PTY this app owns. An external session was
  // handed to the user's own terminal emulator, which forked and took the
  // process with it — main now rejects the call outright rather than pretending,
  // so offering the button would only ever produce an error.
  const canStop = isLive && session?.launchMode === "embedded";
  // A ref is only ever recorded for an agent whose definition says how to reopen
  // one, so its presence *is* the test for "this can be resumed" — the renderer
  // does not need the roster to work that out. Offered only once the session is
  // over: resuming a live one would leave two processes on one conversation,
  // both writing to the same history.
  const canResume =
    !isLive &&
    session !== undefined &&
    session.agentSessionRef !== null &&
    session.agentSessionRef !== undefined;

  /**
   * A kill can be refused — the process may already be gone, or the session may
   * not be ours to stop. The earlier `void killSession(...)` turned that into an
   * unhandled rejection behind a button that appeared to do nothing, which
   * invites the user to press it again.
   */
  const onStop = (sessionId: string): void => {
    setStopError(null);
    void killSession(sessionId).catch((cause: unknown) => {
      if (mountedRef.current) setStopError(describeError(cause));
    });
  };

  /**
   * Hand the conversation back to the agent, and point the dock at the new
   * session it produced.
   *
   * The geometry is a plain default rather than the real terminal's: there is no
   * terminal mounted for a finished session to measure, and the one that does
   * mount resizes itself on its first layout. Refusing to resume until something
   * could be measured would be a worse answer than starting at 80x24 for a frame.
   */
  const onResume = (sessionId: string): void => {
    setStopError(null);
    setResuming(true);
    void resumeSession(sessionId, RESUME_COLS, RESUME_ROWS)
      .then((resumedId) => {
        if (mountedRef.current) openSession(resumedId);
      })
      .catch((cause: unknown) => {
        if (mountedRef.current) setStopError(describeError(cause));
      })
      .finally(() => {
        if (mountedRef.current) setResuming(false);
      });
  };

  if (openSessionId === null) return null;

  return (
    <section
      className="flex h-full min-h-0 flex-col border-x border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised"
      aria-label="Agent terminal"
    >
      {/* Two rows rather than one. The column is ~420px wide, and a single row
          holding the agent name, the status and two buttons leaves the working
          directory a few characters before the ellipsis — which is the one part
          a user actually reads to check the agent is pointed somewhere sane. */}
      <header className="flex flex-shrink-0 flex-col gap-0.5 border-b border-border px-3 py-1.5 dark:border-border-dark">
        <div className="flex items-center gap-2">
          <Terminal
            className="h-3.5 w-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary dark:text-text-primary-dark">
            {session?.agentKey ?? "agent"}
          </span>
          {session !== undefined && (
            <AgentSessionStatusBadge
              session={session}
              busy={busySessionIds.has(session.sessionId)}
            />
          )}
          {canStop && (
            <IconButton
              tooltip="Stop this session"
              aria-label="Stop this session"
              size="xs"
              variant="ghost"
              onClick={() => onStop(openSessionId)}
            >
              <CircleStop className="h-4 w-4" />
            </IconButton>
          )}
          <IconButton
            tooltip={
              isLive
                ? "Close the terminal — the session keeps running"
                : "Close the terminal"
            }
            aria-label="Close the terminal"
            size="xs"
            variant="ghost"
            onClick={close}
          >
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        {/* The agent's own name for the work, when it has set one. Above the
            path and below the agent key, because it is the line that actually
            distinguishes two sessions of the same agent in the same folder —
            which is the case the header was previously unable to tell apart. */}
        {session?.title !== null && session?.title !== undefined && (
          <span
            className="min-w-0 truncate text-xs text-text-secondary dark:text-text-secondary-dark"
            title={session.title}
          >
            {session.title}
          </span>
        )}
        {session !== undefined && (
          // `dir="rtl"` truncates from the *left*, so a deep path keeps the
          // leaf directory — the part that identifies the project — instead of
          // ellipsing it away behind a drive letter every path here shares.
          <span
            dir="rtl"
            className="min-w-0 truncate text-left font-mono text-[11px] text-text-muted dark:text-text-muted-dark"
            title={session.cwd}
          >
            {session.cwd}
          </span>
        )}
      </header>

      {stopError !== null && (
        <p
          className="flex-shrink-0 border-b border-status-error/40 px-3 py-2 text-xs text-status-error"
          role="alert"
        >
          {stopError}
        </p>
      )}

      <div className="min-h-0 flex-1">
        {session === undefined ? (
          <p className="px-3 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
            This session is no longer listed.
          </p>
        ) : (
          // Keyed by session so switching sessions builds a new terminal rather
          // than repainting one — a reused xterm would keep the previous
          // session's scrollback and its cursor state. An exited session is
          // reopened read-only: the host replays its buffer, and there is no
          // process left for keystrokes to reach.
          //
          // `startedAt` is in the key, not decoration. Resuming runs a
          // conversation again in the *same row*, so the id alone does not
          // change and React would keep the existing terminal — still holding
          // the port of the process that ended, which the host has since closed.
          // The terminal would simply stop, showing the old transcript under a
          // session that is running. `startedAt` moves on every resume, so the
          // key changes exactly when a new process is behind the same id.
          <AgentTerminal
            key={`${session.sessionId}:${session.startedAt}`}
            sessionId={session.sessionId}
            readOnly={!isLive}
            // Passed rather than read from the store inside the terminal: the
            // terminal is a plain organism that knows about a session and a
            // bridge, and which panel decided to show it is this component's
            // business. It is also what lets the terminal be focused by a
            // second click on a row that is already open — the only signal
            // that a click happened at all.
            focusRequest={focusRequest}
          />
        )}
      </div>

      {/* The one useful thing left to do with a session that has ended.
          A footer rather than a button in the header row: the header is where
          you act on the terminal you are looking at, and this acts on the
          *conversation* — it starts a new process and moves the dock to it.
          Below the transcript is also where the eye lands after reading why the
          agent stopped, which is when the user decides to pick it back up. */}
      {canResume && (
        <footer className="flex-shrink-0 border-t border-border px-3 py-2 dark:border-border-dark">
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            loading={resuming}
            disabled={resuming}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            onClick={() => onResume(openSessionId)}
          >
            {resuming ? "Resuming…" : "Resume this session"}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-text-muted dark:text-text-muted-dark">
            Reopens the conversation in {session?.agentKey ?? "the agent"} —
            starts a new run.
          </p>
        </footer>
      )}
    </section>
  );
}

/**
 * The geometry a resumed session starts at, before its terminal has mounted and
 * measured itself. The classic 80x24, which every CLI copes with, and which the
 * real `resize` corrects on the first layout a frame later.
 */
const RESUME_COLS = 80;
const RESUME_ROWS = 24;

