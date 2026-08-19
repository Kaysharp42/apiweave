// @vitest-environment jsdom
import "../../../__tests__/setup";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRosterEntry } from "@shared/types/AgentsBridge";

const { agentsMock } = vi.hoisted(() => ({
  agentsMock: {
    isAvailable: vi.fn(() => true),
    resolveLocalPath: vi.fn(),
    listRoster: vi.fn(),
    chooseLocalPath: vi.fn(),
    clearLocalPath: vi.fn(),
    launchEmbedded: vi.fn(),
    launchExternal: vi.fn(),
  },
}));

vi.mock("../../../utils/apiweaveClient", () => ({ agents: agentsMock }));
vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentWorkspace: { workspaceId: "ws-1" } }),
}));

import { AgentLaunchButton } from "../AgentLaunchButton";
import useAgentRosterStore from "../../../stores/AgentRosterStore";

function entry(name: string, isDefault = true): AgentRosterEntry {
  return {
    definition: {
      agentKey: name.toLowerCase(),
      name,
      detectCmd: name.toLowerCase(),
      argv: [],
      env: {},
      promptMode: "none",
      mcpConfigArgs: [],
      unsupportedPlatforms: [],
    },
    availability: { state: "ready" },
    isCustom: false,
    isDefault,
  } as unknown as AgentRosterEntry;
}

const WITH_FOLDER = { localPath: "C:/repo", source: "project" as const };
const NO_FOLDER = { localPath: null, source: "none" as const };

/** A promise whose settlement the test controls, for the in-flight cases. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderWithFolder(): Promise<void> {
  render(<AgentLaunchButton scopeKind="workflow" scopeId="wf-1" />);
  await screen.findByRole("button", { name: /Alpha/ });
}

beforeEach(() => {
  vi.clearAllMocks();
  agentsMock.isAvailable.mockReturnValue(true);
  agentsMock.resolveLocalPath.mockResolvedValue(WITH_FOLDER);
  agentsMock.listRoster.mockResolvedValue([entry("Alpha")]);
  agentsMock.chooseLocalPath.mockResolvedValue(null);
  agentsMock.clearLocalPath.mockResolvedValue(undefined);
  agentsMock.launchExternal.mockResolvedValue({ sessionId: "s1" });
  agentsMock.launchEmbedded.mockResolvedValue({ sessionId: "s1" });
  act(() => {
    useAgentRosterStore.setState({ version: 0 });
  });
});

afterEach(cleanup);

describe("AgentLaunchButton", () => {
  /**
   * The roster is fetched, never pushed. Before the change ticket existed, an
   * agent added or made default in Settings → Agents was invisible to this
   * button until the toolbar remounted.
   */
  it("re-reads the roster when the store reports a change", async () => {
    await renderWithFolder();
    expect(agentsMock.listRoster).toHaveBeenCalledTimes(1);

    agentsMock.listRoster.mockResolvedValue([entry("Beta")]);
    act(() => {
      useAgentRosterStore.getState().rosterChanged();
    });

    expect(await screen.findByRole("button", { name: /Beta/ })).toBeVisible();
  });

  /**
   * The folder actions used to be the ones that never cleared it, so a launch
   * failure sat on screen contradicting the folder change that followed it.
   */
  it("shows a launch failure, and clears it when any next action starts", async () => {
    agentsMock.launchExternal.mockRejectedValue(new Error("spawn ENOENT"));
    await renderWithFolder();

    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("spawn ENOENT");

    await userEvent.click(screen.getByRole("button", { name: "Agent options" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Change folder/ }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("can be dismissed, because the next action may never come", async () => {
    agentsMock.launchExternal.mockRejectedValue(new Error("spawn ENOENT"));
    await renderWithFolder();

    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    await screen.findByRole("alert");

    await userEvent.click(
      screen.getByRole("button", { name: "Dismiss this error" }),
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * Both hang off the same `top-9 right-0` anchor, so rendering them together
   * put an unreadable error on top of the menu items it was describing.
   */
  it("never renders the error over the dropdown", async () => {
    agentsMock.launchExternal.mockRejectedValue(new Error("spawn ENOENT"));
    await renderWithFolder();

    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: "Agent options" }));

    expect(await screen.findByRole("menu")).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * The folder-picker branch renders no menu and, before the fix, no error
   * either — which is exactly the branch where the user has no other clue why
   * nothing happened.
   */
  it("shows a picker failure before any folder is set", async () => {
    agentsMock.resolveLocalPath.mockResolvedValue(NO_FOLDER);
    agentsMock.chooseLocalPath.mockRejectedValue(new Error("dialog failed"));
    render(<AgentLaunchButton scopeKind="workflow" scopeId="wf-1" />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Set folder/ }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("dialog failed");
  });

  /**
   * A directory picker stays open for as long as the user takes to answer it,
   * which is easily longer than the toolbar lives. The guard is observable: an
   * unmounted button must not go on to re-read the roster it can no longer show.
   */
  it("stops working the moment it unmounts", async () => {
    const picked = deferred<string | null>();
    agentsMock.chooseLocalPath.mockReturnValue(picked.promise);
    await renderWithFolder();

    await userEvent.click(screen.getByRole("button", { name: "Agent options" }));
    await userEvent.click(
      await screen.findByRole("menuitem", { name: /Change folder/ }),
    );

    const before = agentsMock.listRoster.mock.calls.length;
    cleanup();
    await act(async () => {
      picked.resolve("C:/other");
    });

    expect(agentsMock.listRoster.mock.calls.length).toBe(before);
  });
});
