import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissingSecretNotice } from "../MissingSecretNotice";
import { useSecretNamesInScope } from "../../../hooks/useSecretNamesInScope";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("../../../hooks/useSecretNamesInScope", () => ({ useSecretNamesInScope: vi.fn() }));

const scope = (names: readonly string[] | null) => ({ names, workspaceId: "ws-1", environmentId: null, refresh: vi.fn() });

describe("MissingSecretNotice", () => {
  beforeEach(() => {
    vi.mocked(useSecretNamesInScope).mockReturnValue(scope(["TEST_PASSWORD"]));
  });

  it("says nothing while the names load, or when the secret exists", () => {
    vi.mocked(useSecretNamesInScope).mockReturnValue(scope(null));
    const { container, rerender } = render(<MissingSecretNotice name="UNSET_PASSWORD_1" />);
    expect(container).toBeEmptyDOMElement();
    vi.mocked(useSecretNamesInScope).mockReturnValue(scope(["UNSET_PASSWORD_1"]));
    rerender(<MissingSecretNotice name="UNSET_PASSWORD_1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names a missing secret and opens the secret form with that name", async () => {
    render(<MissingSecretNotice name="UNSET_PASSWORD_1" />);
    expect(screen.getByRole("status")).toHaveTextContent("The secret UNSET_PASSWORD_1 is not set");
    await userEvent.setup().click(screen.getByRole("button", { name: "Save as secret" }));
    expect(await screen.findByDisplayValue("UNSET_PASSWORD_1")).toBeInTheDocument();
  });
});
