import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SecretsPanel from "../components/SecretsPanel";
import type { ScopedEnvironment } from "../types";

vi.mock("../hooks/useSecretValues", () => ({
  deleteScopedSecret: vi.fn().mockResolvedValue(undefined),
  fetchScopedPublicKey: vi.fn().mockResolvedValue({
    keyId: "test-key-id",
    publicKey: "dGVzdC1wdWJsaWMta2V5",
    algorithm: "libsodium-sealed-box",
  }),
  postScopedEncryptedSecret: vi.fn().mockResolvedValue({
    secretId: "sec-1",
    name: "API_KEY",
    scopeType: "workspace",
    scopeId: "env-1",
    keyId: "test-key-id",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }),
  listScopedSecrets: vi.fn().mockResolvedValue([]),
  useSecretValues: vi.fn(() => ({
    setSecretValue: vi.fn().mockResolvedValue(undefined),
    removeSecretValue: vi.fn().mockResolvedValue(undefined),
    getPublicKey: vi.fn().mockResolvedValue({
      keyId: "test-key-id",
      publicKey: "dGVzdC1wdWJsaWMta2V5",
      algorithm: "libsodium-sealed-box",
    }),
    listSecrets: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("../utils/encryptSecretValue", () => ({
  encryptSecretValue: vi.fn().mockResolvedValue("ZW5jcnlwdGVkLXZhbHVl"),
}));

const makeEnv = (secrets?: Record<string, string>): ScopedEnvironment => ({
  environmentId: "env-1",
  name: "Test Environment",
  variables: {},
  scopeType: "workspace",
  scopeId: "ws-1",
  isDefault: false,
  allowedWorkspaceIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  secrets: secrets ?? {},
});

describe("SecretsPanel", () => {
  const onClose = vi.fn();
  const onSecretsChange = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no secret keys exist", () => {
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("No secrets configured")).toBeInTheDocument();
    expect(
      screen.getByText(/Add secret keys in Environment Manager/),
    ).toBeInTheDocument();
  });

  it("shows secret keys with Set value buttons", () => {
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: "", DB_PASSWORD: "" })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("DB_PASSWORD")).toBeInTheDocument();

    const setValueButtons = screen.getAllByText("Set value");
    expect(setValueButtons).toHaveLength(2);
  });

  it("opens SecretValueEditor modal when Set value is clicked", async () => {
    const user = userEvent.setup();

    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: "" })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    const setValueBtn = screen.getByText("Set value");
    await user.click(setValueBtn);

    await waitFor(() => {
      expect(screen.getByText(/Set value: API_KEY/)).toBeInTheDocument();
    });

    expect(
      screen.getByPlaceholderText(/Enter value for API_KEY/),
    ).toBeInTheDocument();
  });

  it("does not leak plaintext values in DOM after editor closes", async () => {
    const user = userEvent.setup();
    const secretPlaintext = "super-secret-value-xyz-789";

    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: "" })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText("Set value"));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/Enter value for API_KEY/),
      ).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Enter value for API_KEY/);
    await user.type(input, secretPlaintext);

    const cancelBtn = screen.getByText("Cancel");
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Set value: API_KEY/)).not.toBeInTheDocument();
    });

    expect(document.body.innerHTML).not.toContain(secretPlaintext);
  });

  it("uses scoped delete route (not legacy environment route)", async () => {
    const { deleteScopedSecret } = await import("../hooks/useSecretValues");
    const user = userEvent.setup();

    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: "" })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    const removeBtn = screen.getByRole("button", {
      name: /Remove secret API_KEY/i,
    });
    await user.click(removeBtn);

    await waitFor(() => {
      expect(deleteScopedSecret).toHaveBeenCalledWith(
        "environment",
        "env-1",
        "API_KEY",
        "ws-1",
      );
    });
  });

  it("passes workspace id when saving an environment secret value", async () => {
    const { fetchScopedPublicKey, postScopedEncryptedSecret } = await import("../hooks/useSecretValues");
    const user = userEvent.setup();

    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: "" })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText("Set value"));
    await user.type(screen.getByPlaceholderText(/Enter value for API_KEY/), "secret-value");
    await user.click(screen.getByText("Save encrypted"));

    await waitFor(() => {
      expect(fetchScopedPublicKey).toHaveBeenCalledWith("environment", "env-1", "ws-1");
      expect(postScopedEncryptedSecret).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: "environment", scopeId: "env-1", workspaceId: "ws-1" }),
      );
    });
  });
});
