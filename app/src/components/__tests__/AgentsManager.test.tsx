// @vitest-environment jsdom
import "../../__tests__/setup";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    resumeSession: vi.fn(async (_sessionId: string) => "resumed-1"),
  },
}));

vi.mock("../../contexts/AgentSessionsContext", () => ({
  useAgentSessions: () => contextValue,
}));

import { AgentsManager } from "../AgentsManager";
import useAgentDockStore from "../../stores/AgentDockStore";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "session-1",
    workspaceId: "ws-1",
    agentKey: "claude",
    launchMode: "embedded",
    status: "running",
    cwd: "C:/repo",
    startedAt: "2026-08-16T00:00:00.000Z",
    ...overrides,
  } as AgentSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  contextValue.sessions = [session()];
  contextValue.busySessionIds = new Set<string>();
  contextValue.loading = false;
  contextValue.error = null;
  contextValue.isAvailable = true;
  contextValue.killSession.mockResolvedValue(undefined);
  contextValue.removeSession.mockResolvedValue(undefined);
  act(() => useAgentDockStore.getState().close());
});

afterEach(cleanup);

describe("AgentsManager", () => {
  /**
   * `<button>` takes phrasing content only. A `<div>` or `<p>` inside one is
   * repaired by the browser closing the button early, which quietly drops the
   * rest of the row out of the control the user is clicking.
   */
  it("keeps the row button free of block-level content", () => {
    render(<AgentsManager />);

    const row = screen.getByRole("button", {
      name: /claude/i,
    });
    expect(row.querySelector("div")).toBeNull();
    expect(row.querySelector("p")).toBeNull();
  });

  /**
   * The point of the split. A live process the user launched is not news; what
   * they are reading the badge for is whether it is working or waiting on them,
   * and the old badge said "running" — with a spinner — for both.
   */
  it("reads a quiet live session as idle, and a printing one as running", () => {
    const { rerender } = render(<AgentsManager />);

    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Agent idle, waiting for input",
    );
    expect(screen.getByRole("status").querySelector(".animate-spin")).toBeNull();

    contextValue.busySessionIds = new Set(["session-1"]);
    rerender(<AgentsManager />);

    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Agent running",
    );
    expect(
      screen.getByRole("status").querySelector(".animate-spin"),
    ).not.toBeNull();
  });

  /**
   * The badge that is on screen the longest is also the one that flips most
   * often. Announced on every transition, a screen reader would narrate
   * "running, idle, running" over an agent streaming an answer.
   */
  it("does not announce the busy/idle flip to a screen reader", () => {
    render(<AgentsManager />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "off");
  });

  /**
   * The row could not tell two sessions of the same agent in the same folder
   * apart — every one of them read "claude / F:\Work\test-backend". The agent's
   * own title for the work is the only thing that distinguishes them.
   */
  it("shows the agent's title for the session when it has one", () => {
    contextValue.sessions = [
      session({ title: "Agent feature branch review: bugs and gaps" }),
    ];
    render(<AgentsManager />);

    expect(
      screen.getByText("Agent feature branch review: bugs and gaps"),
    ).toBeInTheDocument();
  });

  it("says an external session is detached, not exited", () => {
    contextValue.sessions = [
      session({ launchMode: "external", status: "exited", exitCode: 0 }),
    ];
    render(<AgentsManager />);

    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "Agent detached to your own terminal",
    );
    expect(screen.getByRole("status")).toHaveTextContent("detached");
  });

  it("shows the reason when stopping a session fails", async () => {
    contextValue.killSession.mockRejectedValue(new Error("no such session"));
    render(<AgentsManager />);

    await userEvent.click(
      screen.getByRole("button", { name: "Stop this session" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no such session",
    );
  });

  it("offers Remove only once the session is over", () => {
    contextValue.sessions = [
      session({ sessionId: "live", status: "running" }),
      session({ sessionId: "done", status: "exited", exitCode: 0 }),
    ];
    render(<AgentsManager />);

    expect(
      screen.getAllByRole("button", { name: /Remove this claude session/i }),
    ).toHaveLength(1);
  });

  it("removes a session through the confirmation, and closes a dock left pointing at it", async () => {
    contextValue.sessions = [
      session({ sessionId: "done", status: "exited", exitCode: 0 }),
    ];
    act(() => useAgentDockStore.getState().openSession("done"));
    render(<AgentsManager />);

    await userEvent.click(
      screen.getByRole("button", { name: /Remove this claude session/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove" }),
    );

    expect(contextValue.removeSession).toHaveBeenCalledWith("done");
    await waitFor(() => {
      expect(useAgentDockStore.getState().openSessionId).toBeNull();
    });
  });

  it("shows the reason when removing a session fails", async () => {
    contextValue.sessions = [
      session({ sessionId: "done", status: "exited", exitCode: 0 }),
    ];
    contextValue.removeSession.mockRejectedValue(new Error("not authorized"));
    render(<AgentsManager />);

    await userEvent.click(
      screen.getByRole("button", { name: /Remove this claude session/i }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Remove" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not authorized",
    );
  });
});
