import { useMemo } from "react";
import {
  Bot,
  CircleStop,
  FolderOpen,
  TerminalSquare,
} from "lucide-react";
import type { AgentSession } from "@shared/types/AgentSession";
import { Badge } from "./atoms/Badge";
import { IconButton } from "./atoms/IconButton";
import { Spinner } from "./atoms/Spinner";
import { AgentSessionStatusBadge } from "./molecules/AgentSessionStatusBadge";
import { EmptyState } from "./molecules/EmptyState";
import { useAgentSessions } from "../contexts/AgentSessionsContext";
import useAgentDockStore from "../stores/AgentDockStore";

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
export function AgentsManager({ className }: AgentsManagerProps) {
  const { sessions, loading, error, isAvailable } = useAgentSessions();
  const openSessionId = useAgentDockStore((state) => state.openSessionId);
  const openSession = useAgentDockStore((state) => state.openSession);

  // Live first, then most recent — a running agent is the one thing in this list
  // that is asking for attention.
  const ordered = useMemo(
    () => [...sessions].sort((left, right) => rank(left) - rank(right)),
    [sessions],
  );

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
                isOpen={session.sessionId === openSessionId}
                onOpen={() => openSession(session.sessionId)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface SessionRowProps {
  readonly session: AgentSession;
  readonly isOpen: boolean;
  readonly onOpen: () => void;
}

// fallow-ignore-next-line complexity -- one row presentation per session state (live vs exited, embedded vs external); the CRAP score is the estimated-coverage artifact, not real branch depth
function SessionRow({ session, isOpen, onOpen }: SessionRowProps) {
  const { killSession } = useAgentSessions();
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
          <div className="flex items-center gap-2">
            <Bot
              className="h-3.5 w-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark"
              aria-hidden="true"
            />
            <span className="font-mono text-xs text-text-primary dark:text-text-primary-dark">
              {session.agentKey}
            </span>
            <AgentSessionStatusBadge session={session} />
            {session.launchMode === "external" && (
              <Badge variant="ghost" size="xs">
                own terminal
              </Badge>
            )}
          </div>
          <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-[11px] text-text-muted dark:text-text-muted-dark">
            <FolderOpen className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{session.cwd}</span>
          </p>
          {session.error !== null && session.error !== undefined && (
            <p className="mt-1 text-[11px] text-status-error">{session.error}</p>
          )}
        </button>

        {isLive && session.launchMode === "embedded" && (
          <IconButton
            tooltip="Stop this session"
            aria-label="Stop this session"
            size="xs"
            variant="ghost"
            onClick={() => void killSession(session.sessionId)}
          >
            <CircleStop className="h-4 w-4" />
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
