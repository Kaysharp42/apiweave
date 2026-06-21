import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServiceTokenCreateForm } from "../ServiceTokenCreateForm";
import type { ServiceTokenCreateResponse } from "../../types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthenticatedJson = vi.fn();

vi.mock("../../utils/authenticatedApi", () => ({
  authenticatedJson: (...args: unknown[]) => mockAuthenticatedJson(...args),
}));

vi.mock("../../utils/api", () => ({ default: "http://localhost:8000" }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTokenResponse(
  overrides: Partial<ServiceTokenCreateResponse> = {},
): ServiceTokenCreateResponse {
  return {
    tokenId: "tok-1",
    name: "CI/CD Token",
    token: "aw_secret_token_abc123xyz",
    scopeType: "workspace",
    scopeId: "ws-1",
    permissions: ["workflows:read", "workflows:run"],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ServiceTokenCreateForm", () => {
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderForm(
    props: Partial<React.ComponentProps<typeof ServiceTokenCreateForm>> = {},
  ) {
    return render(
      <ServiceTokenCreateForm
        scopeType="workspace"
        scopeId="ws-1"
        onCreated={mockOnCreated}
        {...props}
      />,
    );
  }

  it("renders token name, description, permissions, and expiry fields", () => {
    renderForm();
    expect(screen.getByText("Token name")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Permissions")).toBeInTheDocument();
    expect(screen.getByText("Expires at")).toBeInTheDocument();
  });

  it("renders permission chips for all available permissions", () => {
    renderForm();
    expect(screen.getByText("secrets:read")).toBeInTheDocument();
    expect(screen.getByText("secrets:create")).toBeInTheDocument();
    expect(screen.getByText("workflows:read")).toBeInTheDocument();
    expect(screen.getByText("workflows:run")).toBeInTheDocument();
    expect(screen.getByText("environments:read")).toBeInTheDocument();
    expect(screen.getByText("collections:read")).toBeInTheDocument();
  });

  it("toggles permission chip selection on click", async () => {
    const user = userEvent.setup();
    renderForm();

    const permChip = screen.getByText("secrets:read");
    await user.click(permChip);

    // After clicking, the chip should have the selected class
    expect(permChip.className).toContain("bg-primary");
  });

  it("shows validation error when name is empty", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByText("Create token"));

    await waitFor(() => {
      expect(screen.getByText("Token name is required")).toBeInTheDocument();
    });
  });

  it("calls API and invokes onCreated with token response", async () => {
    const user = userEvent.setup();
    const tokenResponse = makeTokenResponse();
    mockAuthenticatedJson.mockResolvedValueOnce(tokenResponse);

    renderForm();

    await user.type(
      screen.getByPlaceholderText("CI/CD Deploy Token"),
      "My Token",
    );
    await user.click(screen.getByText("secrets:read"));
    await user.click(screen.getByText("Create token"));

    await waitFor(() => {
      expect(mockOnCreated).toHaveBeenCalledWith(tokenResponse);
    });
  });

  it("clears form fields after successful creation", async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockResolvedValueOnce(makeTokenResponse());

    renderForm();

    await user.type(
      screen.getByPlaceholderText("CI/CD Deploy Token"),
      "My Token",
    );
    await user.type(
      screen.getByPlaceholderText("Used by GitHub Actions for deployment"),
      "For CI",
    );
    await user.click(screen.getByText("secrets:read"));
    await user.click(screen.getByText("Create token"));

    await waitFor(() => {
      expect(mockOnCreated).toHaveBeenCalled();
    });

    // Name field should be cleared
    const nameInput = screen.getByPlaceholderText(
      "CI/CD Deploy Token",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("");
  });

  it("CRITICAL: token value is passed to onCreated exactly once", async () => {
    const user = userEvent.setup();
    const tokenResponse = makeTokenResponse({
      token: "one-time-only-token-value",
    });
    mockAuthenticatedJson.mockResolvedValueOnce(tokenResponse);

    renderForm();

    await user.type(
      screen.getByPlaceholderText("CI/CD Deploy Token"),
      "My Token",
    );
    await user.click(screen.getByText("Create token"));

    await waitFor(() => {
      expect(mockOnCreated).toHaveBeenCalledTimes(1);
    });

    // The token value should be in the callback argument
    const callArgs = mockOnCreated.mock
      .calls[0]![0] as ServiceTokenCreateResponse;
    expect(callArgs.token).toBe("one-time-only-token-value");
  });

  it("shows error message when API call fails", async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockRejectedValueOnce(new Error("Permission denied"));

    renderForm();

    await user.type(
      screen.getByPlaceholderText("CI/CD Deploy Token"),
      "My Token",
    );
    await user.click(screen.getByText("Create token"));

    await waitFor(() => {
      expect(screen.getByText("Permission denied")).toBeInTheDocument();
    });
  });

  it("disables inputs while submitting", async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockReturnValue(new Promise(() => {}));

    renderForm();

    await user.type(
      screen.getByPlaceholderText("CI/CD Deploy Token"),
      "My Token",
    );
    await user.click(screen.getByText("Create token"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("CI/CD Deploy Token")).toBeDisabled();
    });
  });
});
