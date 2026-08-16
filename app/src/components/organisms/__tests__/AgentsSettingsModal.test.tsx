// @vitest-environment jsdom
import "../../../__tests__/setup";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRosterEntry } from "@shared/types/AgentsBridge";

const { agentsMock } = vi.hoisted(() => ({
  agentsMock: {
    isAvailable: vi.fn(() => true),
    listRoster: vi.fn(),
    refreshAvailability: vi.fn(),
    saveCustomAgent: vi.fn(),
    deleteCustomAgent: vi.fn(),
    setDefaultAgentKey: vi.fn(),
  },
}));

vi.mock("../../../utils/apiweaveClient", () => ({ agents: agentsMock }));
vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({ currentWorkspace: { workspaceId: "ws-1" } }),
}));

import { AgentsSettingsModal } from "../AgentsSettingsModal";
import useAgentRosterStore from "../../../stores/AgentRosterStore";

/**
 * A custom agent carrying the three fields the form does not own. They are the
 * whole point of the edit test: the form cannot show them, so only a save that
 * carries them over keeps them.
 */
const CUSTOM: AgentRosterEntry = {
  definition: {
    agentKey: "mine",
    name: "Mine",
    detectCmd: "mine",
    argv: ["chat"],
    expectedProcess: "mine-real.exe",
    env: {},
    promptMode: "none",
    promptFlag: null,
    mcpConfigArgs: [],
    unsupportedPlatforms: ["win32"],
    installUrl: "https://example.test/install",
  },
  availability: { state: "ready" },
  isCustom: true,
  isDefault: true,
} as unknown as AgentRosterEntry;

const BUILTIN: AgentRosterEntry = {
  definition: {
    agentKey: "alpha",
    name: "Alpha",
    detectCmd: "alpha",
    argv: [],
    env: {},
    promptMode: "none",
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
  },
  availability: { state: "ready" },
  isCustom: false,
  isDefault: false,
} as unknown as AgentRosterEntry;

/**
 * A real failure, kept verbatim: this is what the Windows loader returns for an
 * `opencode.exe` whose postinstall never ran and which is therefore still a
 * shell-script stub. It matters that it is long and front-loaded with a path —
 * one line of it says nothing the user can act on.
 */
const BROKEN_DETAIL =
  "This version of C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe is not compatible with the version of Windows you're running. Check your computer's system information and then contact the software publisher.";

const BROKEN: AgentRosterEntry = {
  definition: {
    agentKey: "opencode",
    name: "OpenCode",
    detectCmd: "opencode",
    argv: [],
    env: {},
    promptMode: "none",
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
  },
  availability: { state: "broken", detail: BROKEN_DETAIL },
  isCustom: false,
  isDefault: false,
} as unknown as AgentRosterEntry;

/**
 * `FormField` points its `htmlFor` at the wrapper `<div>` rather than at the
 * control, so `getByLabelText` cannot resolve these fields. The label text is
 * still the honest way to name one, so it is followed by hand.
 */
function field(name: string): HTMLElement {
  const label = Array.from(document.querySelectorAll("label[for]")).find(
    (node) => (node.textContent ?? "").trim().replace(/\*$/, "").trim() === name,
  ) as HTMLLabelElement | undefined;
  if (label === undefined) throw new Error(`No field labelled "${name}"`);
  const control = document
    .getElementById(label.htmlFor)
    ?.querySelector("input, textarea, select");
  if (control === null || control === undefined) {
    throw new Error(`No control under "${name}"`);
  }
  return control as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  agentsMock.isAvailable.mockReturnValue(true);
  agentsMock.listRoster.mockResolvedValue([CUSTOM]);
  agentsMock.refreshAvailability.mockResolvedValue([CUSTOM]);
  agentsMock.saveCustomAgent.mockResolvedValue(CUSTOM);
  agentsMock.deleteCustomAgent.mockResolvedValue(undefined);
  agentsMock.setDefaultAgentKey.mockResolvedValue(undefined);
  act(() => {
    useAgentRosterStore.setState({ version: 0 });
  });
});

afterEach(cleanup);

describe("AgentsSettingsModal", () => {
  /**
   * The first open probes every built-in CLI on PATH, which is slow enough to
   * see. The earlier version rendered an empty `<ul>` for that window — a blank
   * panel that reads as a broken modal rather than a loading one.
   */
  it("shows a spinner on first open instead of a blank panel", async () => {
    agentsMock.listRoster.mockReturnValue(new Promise(() => undefined));
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);

    expect(await screen.findByLabelText("Loading")).toBeInTheDocument();
  });

  /**
   * The clipping was CSS-only, so the text node was always complete and any
   * `getByText` assertion passed while the user still saw an ellipsis. The
   * class is the thing that regressed and the only thing worth asserting.
   */
  it("does not clip the reason a broken agent gives", async () => {
    agentsMock.listRoster.mockResolvedValue([BROKEN]);
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);

    const reason = await screen.findByText(BROKEN_DETAIL);
    expect(reason).not.toHaveClass("truncate");
    expect(reason).toHaveAttribute("title", BROKEN_DETAIL);
  });

  /**
   * The modal is mounted for the life of the app and only toggles `isOpen`, so
   * closing is the one chance it gets to forget an abandoned draft.
   */
  it("forgets a half-typed form when it closes", async () => {
    const { rerender } = render(
      <AgentsSettingsModal isOpen onClose={() => undefined} />,
    );
    await screen.findByText("Mine");

    await userEvent.click(
      screen.getByRole("button", { name: "Add custom agent" }),
    );
    await userEvent.type(field("Key"), "abandoned");
    expect(field("Key")).toHaveValue("abandoned");

    rerender(<AgentsSettingsModal isOpen={false} onClose={() => undefined} />);
    rerender(<AgentsSettingsModal isOpen onClose={() => undefined} />);

    expect(
      await screen.findByRole("button", { name: "Add custom agent" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Add custom agent" }),
    );
    expect(field("Key")).toHaveValue("");
  });

  /**
   * `saveCustomAgent` is a full replacement and this form owns only part of a
   * definition. Restating the rest as empty deleted it from an agent the user
   * was only renaming.
   */
  it("keeps the fields the form does not own when editing", async () => {
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);
    await screen.findByText("Mine");

    await userEvent.click(screen.getByRole("button", { name: "Edit Mine" }));
    const name = field("Display name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(screen.getByRole("button", { name: "Save agent" }));

    await waitFor(() => {
      expect(agentsMock.saveCustomAgent).toHaveBeenCalled();
    });
    expect(agentsMock.saveCustomAgent).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        agentKey: "mine",
        name: "Renamed",
        expectedProcess: "mine-real.exe",
        unsupportedPlatforms: ["win32"],
        installUrl: "https://example.test/install",
      }),
    );
  });

  it("leaves those fields empty for a genuinely new agent", async () => {
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);
    await screen.findByText("Mine");

    await userEvent.click(
      screen.getByRole("button", { name: "Add custom agent" }),
    );
    await userEvent.type(field("Key"), "fresh");
    await userEvent.type(field("Display name"), "Fresh");
    await userEvent.type(field("Command"), "fresh");
    await userEvent.click(screen.getByRole("button", { name: "Add agent" }));

    await waitFor(() => {
      expect(agentsMock.saveCustomAgent).toHaveBeenCalled();
    });
    expect(agentsMock.saveCustomAgent).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        agentKey: "fresh",
        expectedProcess: null,
        unsupportedPlatforms: [],
        installUrl: null,
      }),
    );
  });

  /**
   * The bump is what the launch controls listen to — they hold their own copy of
   * the roster and nothing pushes one to them.
   */
  it("reports a save to every other roster reader", async () => {
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);
    await screen.findByText("Mine");

    await userEvent.click(screen.getByRole("button", { name: "Edit Mine" }));
    await userEvent.click(screen.getByRole("button", { name: "Save agent" }));

    await waitFor(() => {
      expect(useAgentRosterStore.getState().version).toBe(1);
    });
  });

  it("reports a delete to every other roster reader", async () => {
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);
    await screen.findByText("Mine");

    await userEvent.click(screen.getByRole("button", { name: "Remove Mine" }));
    // Named exactly "Remove": the row's icon button is "Remove Mine", so the
    // confirmation's own button is the only exact match.
    await userEvent.click(
      await screen.findByRole("button", { name: "Remove" }),
    );

    await waitFor(() => {
      expect(agentsMock.deleteCustomAgent).toHaveBeenCalledWith("ws-1", "mine");
    });
    expect(useAgentRosterStore.getState().version).toBe(1);
  });

  it("reports a new default to every other roster reader", async () => {
    agentsMock.listRoster.mockResolvedValue([CUSTOM, BUILTIN]);
    render(<AgentsSettingsModal isOpen onClose={() => undefined} />);
    await screen.findByText("Alpha");

    await userEvent.click(
      screen.getByRole("button", { name: "Make Alpha the default agent" }),
    );

    await waitFor(() => {
      expect(useAgentRosterStore.getState().version).toBe(1);
    });
  });
});
