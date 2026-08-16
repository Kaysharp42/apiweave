import { CircleCheck, CircleX, Loader2 } from "lucide-react";
import type { AgentSession } from "@shared/types/AgentSession";
import { Badge } from "../atoms/Badge";

interface AgentSessionStatusBadgeProps {
  readonly session: AgentSession;
}

/**
 * What an agent session is doing, as a glyph plus a word.
 *
 * Shared between the terminal dock and the Agents list rather than written twice,
 * which is how the first version of this ended up telling two different stories
 * about one session: the list said "exit 1" in red while the dock said "exited"
 * in green, for the same row. The exit code is part of the status precisely
 * because "exited" on its own invites the reader to assume success, and a stopped
 * or crashed agent is the case they most need to notice.
 *
 * Never colour alone, and never a pulsing dot: a session can sit at "running"
 * for twenty minutes, which is the duration over which a pulse stops being
 * information and becomes an irritation.
 */
export function AgentSessionStatusBadge({
  session,
}: AgentSessionStatusBadgeProps) {
  switch (session.status) {
    case "starting":
    case "running":
      return (
        <Badge variant="warning" size="xs">
          <Loader2
            className="h-3 w-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {session.status}
        </Badge>
      );
    case "exited": {
      const code = session.exitCode ?? 0;
      return code === 0 ? (
        <Badge variant="success" size="xs">
          <CircleCheck className="h-3 w-3" aria-hidden="true" />
          exited
        </Badge>
      ) : (
        <Badge variant="error" size="xs">
          <CircleX className="h-3 w-3" aria-hidden="true" />
          exit {code}
        </Badge>
      );
    }
    case "failed":
      return (
        <Badge variant="error" size="xs">
          <CircleX className="h-3 w-3" aria-hidden="true" />
          failed
        </Badge>
      );
  }
}
