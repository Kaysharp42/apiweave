// @vitest-environment jsdom
import "../../../__tests__/setup";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@shared/types/AgentSession";

const { contextValue } = vi.hoisted(() => ({
  contextValue: {
    sessions: [] as readonly AgentSession[],
    busySessionIds: new Set<string>() as ReadonlySet<string>,
    loading: false,
    error: null as string | null,
    isAvailable: true,
    refresh: vi.fn(async () => undefined),
    killSession: vi.fn(async (_sessionId: string) => undefined),
    removeSession: vi.fn(async (_sessionId: string) => undefined),
    resumeSession: vi.fn(
      async (_sessionId: string, _cols: number, _rows: number) => "resumed-1",
    ),
  },
}));

vi.mock("../../../contexts/AgentSessionsContext", () => ({
  useAgentSessions: () => contextValue,
}));

/**
 * The terminal is stubbed wholesale: xterm.js measures a canvas at import time
 * and cannot load in jsdom, and none of what is under test here is the
 * transcript — it is the chrome around it.
 */
vi.mock("../AgentTerminal", () => ({
  AgentTerminal: ({
    sessionId,
    focusRequest,
  }: {
    readonly sessionId: string;
    readonly focusRequest?: number;
  }) => (
    <div data-testid="terminal" data-focus-request={focusRequest}>
      {sessionId}
    </div>
  ),
}));

import { AgentDock } from "../AgentDock";
import useAgentDockStore from "../../../stores/AgentDockStore";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "session-1",
    workspaceId: "ws-1",
    agentKey: "opencode2",
    launchMode: "embedded",
    status: "exited",
    exitCode: 1,
    cwd: "F:/Work/test-backend",
    startedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  contextValue.sessions = [session()];
  contextValue.busySessionIds = new Set<string>();
  contextValue.resumeSession.mockResolvedValue("resumed-1");
  act(() => useAgentDockStore.getState().openSession("session-1"));
});

afterEach(() => {
  act(() => useAgentDockStore.getState().close());
  cleanup();
});

describe("AgentDock resume", () => {
  /**
   * The state from the bug report: the app restarted, so the process is gone and
   * the PTY host went with it, taking the scrollback. The panel used to be able
   * to say only "this session's output is no longer available" — a dead end on
   * the screen the user opened precisely to get their work back.
   */
  it("offers to reopen a finished session that recorded a conversation id", () => {
    contextValue.sessions = [session({ agentSessionRef: "ses_ff4aa620" })];
    render(<AgentDock />);

    expect(
      screen.getByRole("button", { name: /Resume this session/i }),
    ).toBeInTheDocument();
  });

  /**
   * A ref is only ever stored for an agent whose definition says how to reopen
   * one, so its absence means the CLI cannot do this — and a button that could
   * only ever produce an error is worse than no button.
   */
  it("offers nothing when no conversation id was recorded", () => {
    contextValue.sessions = [session({ agentSessionRef: null })];
    render(<AgentDock />);

    expect(
      screen.queryByRole("button", { name: /Resume this session/i }),
    ).toBeNull();
  });

  /** Resuming a live session would put two processes on one conversation. */
  it("offers nothing while the session is still running", () => {
    contextValue.sessions = [
      session({ status: "running", exitCode: null, agentSessionRef: "ses_x" }),
    ];
    render(<AgentDock />);

    expect(
      screen.queryByRole("button", { name: /Resume this session/i }),
    ).toBeNull();
  });

  /**
   * The row is the conversation. Resuming runs it again in place rather than
   * adding a second row — three resumes of one agent used to leave three
   * near-identical rows the list had no way to tell apart.
   */
  it("stays on the same session, which is the one that resumed", async () => {
    contextValue.resumeSession.mockResolvedValue("session-1");
    contextValue.sessions = [session({ agentSessionRef: "ses_ff4aa620" })];
    render(<AgentDock />);

    await userEvent.click(
      screen.getByRole("button", { name: /Resume this session/i }),
    );

    expect(contextValue.resumeSession).toHaveBeenCalledWith(
      "session-1",
      expect.any(Number),
      expect.any(Number),
    );
    await waitFor(() => {
      expect(useAgentDockStore.getState().openSessionId).toBe("session-1");
    });
  });

  /**
   * The terminal is keyed by session id *and* start time. Resuming keeps the id,
   * so without the second half React would keep the existing xterm — still
   * holding the port of the process that ended, which the host has since closed.
   * It would sit there showing the old transcript under a running session.
   */
  it("builds a new terminal when the same session starts again", () => {
    contextValue.sessions = [
      session({ status: "running", startedAt: "2026-08-16T00:00:00.000Z" }),
    ];
    const { rerender } = render(<AgentDock />);
    const before = screen.getByTestId("terminal");

    contextValue.sessions = [
      session({ status: "running", startedAt: "2026-08-16T09:30:00.000Z" }),
    ];
    rerender(<AgentDock />);

    expect(screen.getByTestId("terminal")).not.toBe(before);
  });

  /**
   * Resuming starts a process, and it can be refused — the folder has moved, the
   * CLI is gone, the conversation was deleted from under it. A button that
   * silently does nothing invites the user to press it again.
   */
  it("shows why a resume was refused", async () => {
    contextValue.sessions = [session({ agentSessionRef: "ses_ff4aa620" })];
    contextValue.resumeSession.mockRejectedValue(
      new Error("The configured folder no longer exists"),
    );
    render(<AgentDock />);

    await userEvent.click(
      screen.getByRole("button", { name: /Resume this session/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The configured folder no longer exists",
    );
    // The dock stays where it is, rather than pointing at a session that was
    // never created.
    expect(useAgentDockStore.getState().openSessionId).toBe("session-1");
  });

  /**
   * The mouse-free path from the session list to the prompt. Clicking a row that
   * is already open leaves the id, the terminal and every other prop exactly
   * where they were, so the request count is the only thing that can tell the
   * terminal a click happened — without it, the second click does nothing and
   * the user is back to reaching for the mouse to type.
   */
  it("asks for focus again when an already-open session is opened", () => {
    contextValue.sessions = [session({ status: "running", exitCode: null })];
    render(<AgentDock />);
    const before = Number(
      screen.getByTestId("terminal").getAttribute("data-focus-request"),
    );

    act(() => useAgentDockStore.getState().openSession("session-1"));

    expect(
      Number(screen.getByTestId("terminal").getAttribute("data-focus-request")),
    ).toBe(before + 1);
  });

  it("shows the agent's own title for the session", () => {
    contextValue.sessions = [
      session({ title: "Agent feature branch review: bugs and gaps" }),
    ];
    render(<AgentDock />);

    expect(
      screen.getByText("Agent feature branch review: bugs and gaps"),
    ).toBeInTheDocument();
  });
});
