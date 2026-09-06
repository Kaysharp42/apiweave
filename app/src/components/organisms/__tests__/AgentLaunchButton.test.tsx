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

const { toastMock } = vi.hoisted(() => ({ toastMock: { error: vi.fn() } }));

vi.mock("sonner", () => ({ toast: toastMock }));
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
   * The prompt pipeline was built end to end in main — argv, flag and stdin
   * modes, and a refusal for an external stdin launch — and no caller ever sent
   * one. This is the field that does.
   */
  it("hands the typed task to the launch, once", async () => {
    const onEmbeddedSession = vi.fn();
    render(
      <AgentLaunchButton
        scopeKind="workflow"
        scopeId="wf-1"
        onEmbeddedSession={onEmbeddedSession}
      />,
    );
    await screen.findByRole("button", { name: /Alpha/ });

    await userEvent.click(screen.getByRole("button", { name: "Agent options" }));
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Task for the agent" }),
      "add a 404 assertion{Enter}",
    );

    await waitFor(() => {
      expect(agentsMock.launchEmbedded).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: "add a 404 assertion" }),
      );
    });

    // Cleared on dispatch, so the next launch does not repeat the same task.
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    await waitFor(() => {
      expect(agentsMock.launchEmbedded).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ prompt: expect.anything() }),
      );
    });
  });

  /**
   * The sidebar's project rows clip a popover on both axes, so compact drops
   * the menu — and a failure there has to reach a toast instead of the error
   * card it can no longer render. Losing it silently is the whole risk.
   */
  it("has no menu in compact mode, and reports failures as a toast", async () => {
    agentsMock.launchExternal.mockRejectedValue(new Error("spawn ENOENT"));
    render(
      <AgentLaunchButton scopeKind="project" scopeId="p-1" showLabel={false} compact />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Alpha/ }));

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("spawn ENOENT");
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Agent options" })).toBeNull();
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
