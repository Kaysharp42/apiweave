// @vitest-environment jsdom
import "../../__tests__/setup";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@shared/types/AgentSession";
import type {
  AgentEvent,
  AgentSessionEvent,
} from "@shared/types/AgentSessionEvent";
import type { AgentSessionsContextValue } from "../../types/AgentSessionsContextValue";

const { agentsMock } = vi.hoisted(() => ({
  agentsMock: {
    isAvailable: vi.fn(() => true),
    listSessions: vi.fn(),
    killSession: vi.fn(),
    deleteSession: vi.fn(),
    onSessionChanged: vi.fn(() => () => undefined),
  },
}));

/**
 * Mutable so a test can switch workspaces the way the app does — the provider
 * reads this on every render, and a re-render is what a real switch produces.
 */
const { workspaceRef } = vi.hoisted(() => ({
  workspaceRef: { current: "ws-1" as string | null },
}));

vi.mock("../../utils/apiweaveClient", () => ({ agents: agentsMock }));
vi.mock("../WorkspaceContext", () => ({
  useWorkspace: () => ({
    currentWorkspace:
      workspaceRef.current === null
        ? null
        : { workspaceId: workspaceRef.current },
  }),
}));

import {
  AgentSessionsProvider,
  useAgentSessions,
} from "../AgentSessionsContext";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "session-1",
    workspaceId: "ws-1",
    agentKey: "claude",
    launchMode: "embedded",
    status: "exited",
    cwd: "C:/repo",
    startedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

/** The live context value, captured so a test can call its mutators directly. */
let captured: AgentSessionsContextValue | null = null;

/**
 * Push an event through the provider's own subscriber, the way main does.
 * Takes the unstamped event and adds `seq`/`ts` here, so a test reads as the
 * transition it is about rather than as boilerplate.
 */
function emit(event: AgentEvent): void {
  const calls = agentsMock.onSessionChanged.mock.calls as unknown as readonly [
    (event: AgentSessionEvent) => void,
  ][];
  const listener = calls.at(-1)?.[0];
  if (listener === undefined) throw new Error("provider never subscribed");
  act(() => {
    listener({ ...event, seq: 1, ts: "2026-08-16T00:00:00.000Z" });
  });
}

function Probe() {
  captured = useAgentSessions();
  return null;
}

async function mount(): Promise<void> {
  render(
    <AgentSessionsProvider>
      <Probe />
    </AgentSessionsProvider>,
  );
  await waitFor(() => {
    expect(captured?.loading).toBe(false);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  workspaceRef.current = "ws-1";
  agentsMock.isAvailable.mockReturnValue(true);
  agentsMock.onSessionChanged.mockReturnValue(() => undefined);
  agentsMock.listSessions.mockResolvedValue([session()]);
  agentsMock.killSession.mockResolvedValue(session());
  agentsMock.deleteSession.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("AgentSessionsProvider", () => {
  it("forgets a session and re-reads the list, because a delete raises no process event", async () => {
    await mount();
    expect(captured?.sessions).toHaveLength(1);

    agentsMock.listSessions.mockResolvedValue([]);
    await act(async () => {
      await captured?.removeSession("session-1");
    });

    expect(agentsMock.deleteSession).toHaveBeenCalledWith("session-1");
    expect(captured?.sessions).toHaveLength(0);
  });

  /**
   * The contract the call sites depend on. A kill that main refuses has to reach
   * the button the user pressed — absorbed here, it would become an unhandled
   * rejection and a Stop that appears to do nothing.
   */
  it("rejects to the caller when a kill fails", async () => {
    await mount();
    agentsMock.killSession.mockRejectedValue(new Error("no such session"));

    await expect(captured?.killSession("session-1")).rejects.toThrow(
      "no such session",
    );
  });

  /**
   * The reason activity is not simply another event that triggers `refresh`.
   * An agent printing an answer flips this on and off all afternoon, and a
   * list re-read per flip would put an IPC round trip and a table read behind
   * output that changed nothing on any row.
   */
  it("tracks activity without re-reading the session list", async () => {
    agentsMock.listSessions.mockResolvedValue([
      session({ status: "running" }),
    ]);
    await mount();
    const readsAfterMount = agentsMock.listSessions.mock.calls.length;

    emit({ kind: "agent.activity", sessionId: "session-1", busy: true });

    expect(captured?.busySessionIds.has("session-1")).toBe(true);
    expect(agentsMock.listSessions).toHaveBeenCalledTimes(readsAfterMount);

    emit({ kind: "agent.activity", sessionId: "session-1", busy: false });

    expect(captured?.busySessionIds.has("session-1")).toBe(false);
  });

  /**
   * The host stops reporting activity at the exit rather than sending a final
   * "quiet", so an agent killed mid-output would otherwise keep its busy flag
   * for ever — a finished row still claiming the agent is typing.
   */
  it("clears the busy flag when a session ends", async () => {
    agentsMock.listSessions.mockResolvedValue([
      session({ status: "running" }),
    ]);
    await mount();
    emit({ kind: "agent.activity", sessionId: "session-1", busy: true });
    expect(captured?.busySessionIds.has("session-1")).toBe(true);

    agentsMock.listSessions.mockResolvedValue([
      session({ status: "exited", exitCode: 0 }),
    ]);
    emit({ kind: "agent.exited", sessionId: "session-1", exitCode: 0 });

    await waitFor(() => {
      expect(captured?.busySessionIds.has("session-1")).toBe(false);
    });
    expect(agentsMock.listSessions.mock.calls.length).toBeGreaterThan(1);
  });

  /**
   * A read belongs to the workspace it was issued for. Switching starts a
   * second one while the first is still in flight, and whichever main answers
   * last used to win — so a slow first response painted the previous
   * workspace's sessions over the current one's, and nothing corrected it until
   * some unrelated transition event forced another read.
   */
  it("ignores a slow list read for a workspace the user has already left", async () => {
    let releaseFirst: (rows: readonly AgentSession[]) => void = () => undefined;
    agentsMock.listSessions.mockImplementationOnce(
      () =>
        new Promise<readonly AgentSession[]>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const view = render(
      <AgentSessionsProvider>
        <Probe />
      </AgentSessionsProvider>,
    );

    workspaceRef.current = "ws-2";
    agentsMock.listSessions.mockResolvedValue([
      session({ sessionId: "from-ws-2", workspaceId: "ws-2" }),
    ]);
    view.rerender(
      <AgentSessionsProvider>
        <Probe />
      </AgentSessionsProvider>,
    );
    await waitFor(() => {
      expect(captured?.sessions[0]?.sessionId).toBe("from-ws-2");
    });

    await act(async () => {
      releaseFirst([session({ sessionId: "from-ws-1" })]);
    });

    expect(captured?.sessions[0]?.sessionId).toBe("from-ws-2");
  });

  it("rejects to the caller when a delete fails, and leaves the list alone", async () => {
    await mount();
    agentsMock.deleteSession.mockRejectedValue(new Error("not authorized"));

    await expect(captured?.removeSession("session-1")).rejects.toThrow(
      "not authorized",
    );
    expect(captured?.sessions).toHaveLength(1);
  });
});
