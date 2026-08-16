import { Circle, CircleCheck, CircleX, ExternalLink, Loader2 } from "lucide-react";
import type { AgentSession } from "@shared/types/AgentSession";
import { Badge } from "../atoms/Badge";

interface AgentSessionStatusBadgeProps {
  readonly session: AgentSession;
  /**
   * Whether the agent is printing right now, from
   * `useAgentSessions().busySessionIds`. Defaults to false, which is also what
   * a caller with no access to that set should show: an agent that is quiet.
   */
  readonly busy?: boolean;
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
 * A live session splits in two, because "running" was answering a question
 * nobody asks. The user knows the agent is alive — they launched it, and it is
 * in the list. What they want to know is whether it is working or waiting on
 * them, and a badge that says `running` for both spent most of its life
 * spinning at an agent sitting idle at its prompt. Three of those in a sidebar
 * is motion with no information in it, which is worse than no badge at all: it
 * trains the reader to ignore the one case where the spinner means something.
 *
 * So the spinner is now load-bearing — it turns only while output is actually
 * arriving — and a quiet agent gets a still dot. Never colour alone, and never
 * a pulsing dot for the resting state: a session can sit at idle for twenty
 * minutes, which is the duration over which a pulse stops being information and
 * becomes an irritation.
 *
 * `role="status"` — the same live region `StatusBadge` uses — because these
 * transitions are the one thing here that happens without the user doing
 * anything: an agent exits minutes after it was launched, and a badge that
 * silently repaints tells a screen-reader user nothing. Polite, never assertive:
 * an exit is worth hearing at the next pause, not worth interrupting for. The
 * `aria-label` carries the whole state as words, because the glyph is decorative
 * and "exit 1" read as two tokens is not a sentence.
 *
 * One exception to the live region, and it is the reason busy/idle is safe to
 * announce at all: the working/waiting badge is `aria-live="off"`. It flips
 * every time the agent pauses to think, and a screen reader narrating "running,
 * idle, running" over a streaming answer would make the panel unusable. It
 * stays readable on demand; it just stops shouting.
 */
// fallow-ignore-next-line complexity -- one switch over the session's states, each arm a single badge; splitting it would scatter the vocabulary this component exists to hold in one place
export function AgentSessionStatusBadge({
  session,
  busy = false,
}: AgentSessionStatusBadgeProps) {
  // Checked before the status, not inside the `exited` arm where it used to
  // live. An external session reaches `exited` the moment the emulator is
  // spawned — the process was handed to the user's own terminal, which forked
  // and took it — so its row spends a fraction of a second at `starting` and
  // the rest of its life at a green `exited` that means nothing of the kind.
  // Neither word is about this session any more; `detached` is.
  if (session.launchMode === "external" && session.status !== "failed") {
    return (
      <Badge
        variant="secondary"
        size="xs"
        role="status"
        aria-label="Agent detached to your own terminal"
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        detached
      </Badge>
    );
  }

  switch (session.status) {
    case "starting":
      return (
        <Badge
          variant="warning"
          size="xs"
          role="status"
          aria-label="Agent starting"
        >
          <Loader2
            className="h-3 w-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          starting
        </Badge>
      );
    case "running":
      return busy ? (
        <Badge
          variant="warning"
          size="xs"
          role="status"
          aria-live="off"
          aria-label="Agent running"
        >
          <Loader2
            className="h-3 w-3 animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          running
        </Badge>
      ) : (
        <Badge
          variant="secondary"
          size="xs"
          role="status"
          aria-live="off"
          aria-label="Agent idle, waiting for input"
        >
          {/* Filled rather than outlined, and smaller than the other glyphs:
              this is the badge that is on screen the longest, so it is the one
              that has to sit quietly next to the agent's name. */}
          <Circle className="h-2 w-2 fill-current" aria-hidden="true" />
          idle
        </Badge>
      );
    case "exited": {
      const code = session.exitCode ?? 0;
      return code === 0 ? (
        <Badge
          variant="success"
          size="xs"
          role="status"
          aria-label="Agent exited successfully"
        >
          <CircleCheck className="h-3 w-3" aria-hidden="true" />
          exited
        </Badge>
      ) : (
        <Badge
          variant="error"
          size="xs"
          role="status"
          aria-label={`Agent exited with code ${String(code)}`}
        >
          <CircleX className="h-3 w-3" aria-hidden="true" />
          exit {code}
        </Badge>
      );
    }
    case "failed":
      return (
        <Badge
          variant="error"
          size="xs"
          role="status"
          aria-label="Agent failed to start"
        >
          <CircleX className="h-3 w-3" aria-hidden="true" />
          failed
        </Badge>
      );
  }
}
