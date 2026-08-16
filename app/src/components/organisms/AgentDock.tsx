import { CircleStop, Terminal, X } from "lucide-react";
import { IconButton } from "../atoms/IconButton";
import { AgentSessionStatusBadge } from "../molecules/AgentSessionStatusBadge";
import { useAgentSessions } from "../../contexts/AgentSessionsContext";
import useAgentDockStore from "../../stores/AgentDockStore";
import { AgentTerminal } from "./AgentTerminal";

/**
 * The agent, docked below the canvas it is editing.
 *
 * A bottom dock and not a page, because the entire argument for wiring MCP into
 * the launch is that the agent edits the workflow while you watch it happen — a
 * terminal that replaced the canvas would throw that away. The Agents section
 * keeps a full-height view for sessions with no workflow attached.
 *
 * Everything around the terminal is ordinary app chrome: hairline borders, near
 * flat, and session state as a badge with a glyph rather than a coloured dot.
 * Inside the frame is the one place in the app where sixteen colours are not
 * APIWeave's to choose.
 */
export function AgentDock() {
  const openSessionId = useAgentDockStore((state) => state.openSessionId);
  const close = useAgentDockStore((state) => state.close);
  const { sessions, killSession } = useAgentSessions();

  if (openSessionId === null) return null;

  const session = sessions.find((row) => row.sessionId === openSessionId);
  const isLive = session?.status === "running" || session?.status === "starting";

  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised"
      aria-label="Agent terminal"
    >
      <header className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 dark:border-border-dark">
        <Terminal
          className="h-3.5 w-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark"
          aria-hidden="true"
        />
        <span className="flex-shrink-0 font-mono text-xs text-text-primary dark:text-text-primary-dark">
          {session?.agentKey ?? "agent"}
        </span>
        {session !== undefined && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted dark:text-text-muted-dark"
            title={session.cwd}
          >
            {session.cwd}
          </span>
        )}
        {session !== undefined && <AgentSessionStatusBadge session={session} />}
        {isLive && (
          <IconButton
            tooltip="Stop this session"
            aria-label="Stop this session"
            size="xs"
            variant="ghost"
            onClick={() => void killSession(openSessionId)}
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
      </header>

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
          <AgentTerminal
            key={session.sessionId}
            sessionId={session.sessionId}
            readOnly={!isLive}
          />
        )}
      </div>
    </section>
  );
}

