import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ScopedSecretList } from "../ScopedSecretList";
import { authenticatedJson } from "../../utils/apiweaveClient";

vi.mock("../../utils/apiweaveClient", () => ({
  default: "ipc://apiweave",
  authenticatedJson: vi.fn(),
}));

const mocked = vi.mocked(authenticatedJson);

const secret = (name: string, scopeId: string) => ({
  secretId: `${scopeId}-${name}`,
  name,
  scopeType: "workspace" as const,
  scopeId,
  keyId: `sealed-box:workspace:${scopeId}`,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

beforeEach(() => mocked.mockReset());

/**
 * A secret name belongs to exactly one scope. The secrets page renders this list
 * once per workspace, so several fetches are in flight at once — and a response
 * that lands under the wrong heading is a cross-workspace leak of secret names
 * with actions attached that then target the wrong scope.
 */
describe("ScopedSecretList — one scope at a time", () => {
  it("drops a slow response for a scope it has already left", async () => {
    let releaseFirst: (value: unknown) => void = () => {};
    mocked
      .mockImplementationOnce(
        () => new Promise((resolve) => (releaseFirst = resolve)),
      )
      .mockResolvedValueOnce({ secrets: [secret("FROM_B", "ws-b")], total: 1 });

    const { rerender } = render(
      <ScopedSecretList
        scopeType="workspace"
        scopeId="ws-a"
        onChanged={vi.fn()}
      />,
    );
    rerender(
      <ScopedSecretList
        scopeType="workspace"
        scopeId="ws-b"
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText("FROM_B");

    releaseFirst({ secrets: [secret("FROM_A", "ws-a")], total: 1 });

    await waitFor(() => expect(screen.queryByText("FROM_A")).toBeNull());
    expect(screen.getByText("FROM_B")).toBeTruthy();
  });

  it("empties the list on a failed fetch rather than keeping the last scope's", async () => {
    mocked
      .mockResolvedValueOnce({ secrets: [secret("FROM_A", "ws-a")], total: 1 })
      .mockRejectedValueOnce(new Error("denied"));

    const { rerender } = render(
      <ScopedSecretList
        scopeType="workspace"
        scopeId="ws-a"
        onChanged={vi.fn()}
      />,
    );
    await screen.findByText("FROM_A");

    rerender(
      <ScopedSecretList
        scopeType="workspace"
        scopeId="ws-b"
        onChanged={vi.fn()}
      />,
    );

    await screen.findByRole("alert");
    expect(screen.queryByText("FROM_A")).toBeNull();
  });

  it("hides Delete when read-only, but still offers copy and move", async () => {
    mocked.mockResolvedValue({
      secrets: [secret("API_KEY", "ws-b")],
      total: 1,
    });

    render(
      <ScopedSecretList
        scopeType="workspace"
        scopeId="ws-b"
        readOnly
        onChanged={vi.fn()}
        onDuplicate={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    await screen.findByText("API_KEY");

    expect(screen.queryByLabelText("Delete secret")).toBeNull();
    expect(screen.getByLabelText("Duplicate to another scope")).toBeTruthy();
    expect(screen.getByLabelText("Move to another workspace")).toBeTruthy();
  });
});
