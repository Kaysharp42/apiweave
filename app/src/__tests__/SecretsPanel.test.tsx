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
}));

vi.mock("../utils/encryptSecretValue", () => ({
  encryptSecretValue: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));

const makeEnv = (): ScopedEnvironment => ({
  environmentId: "env-1",
  name: "Test Environment",
  variables: {},
  scopeType: "workspace",
  scopeId: "ws-1",
  isDefault: false,
  allowedWorkspaceIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

/** Secrets stored in the environment's scope, as the secret store lists them. */
async function storeHolds(...names: string[]): Promise<void> {
  const { listScopedSecrets } = await import("../hooks/useSecretValues");
  vi.mocked(listScopedSecrets).mockResolvedValue(
    names.map((name) => ({
      secretId: `sec-${name}`,
      name,
      scopeType: "environment",
      scopeId: "env-1",
      keyId: "test-key-id",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    })),
  );
}

describe("SecretsPanel", () => {
  const onClose = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    await storeHolds();
  });

  it("renders empty state when the store holds no secrets for the environment", async () => {
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("No secrets in this environment")).toBeInTheDocument();
  });

  it("lists the environment's secrets from the secret store, with Set value buttons", async () => {
    const { listScopedSecrets } = await import("../hooks/useSecretValues");
    await storeHolds("API_KEY", "DB_PASSWORD");
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("API_KEY")).toBeInTheDocument();
    expect(screen.getByText("DB_PASSWORD")).toBeInTheDocument();
    expect(listScopedSecrets).toHaveBeenCalledWith("environment", "env-1", "ws-1");

    const setValueButtons = screen.getAllByText("Set value");
    expect(setValueButtons).toHaveLength(2);
  });

  it("opens SecretValueEditor modal when Set value is clicked", async () => {
    const user = userEvent.setup();

    await storeHolds("API_KEY");
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onClose={onClose}
      />,
    );

    const setValueBtn = await screen.findByText("Set value");
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

    await storeHolds("API_KEY");
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onClose={onClose}
      />,
    );

    await user.click(await screen.findByText("Set value"));

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

    await storeHolds("API_KEY");
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onClose={onClose}
      />,
    );

    const removeBtn = await screen.findByRole("button", {
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

    await storeHolds("API_KEY");
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onClose={onClose}
      />,
    );

    await user.click(await screen.findByText("Set value"));
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
