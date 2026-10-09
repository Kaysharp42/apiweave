import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentVariablesImportDialog } from "../EnvironmentVariablesImportDialog";
import {
  fetchScopedPublicKey,
  listScopedSecrets,
  postScopedEncryptedSecret,
} from "../../../hooks/useSecretValues";
import { encryptSecretValue } from "../../../utils/encryptSecretValue";
import type { ScopedEnvironment } from "../../../types";

vi.mock("../../../hooks/useSecretValues", () => ({
  listScopedSecrets: vi.fn(),
  fetchScopedPublicKey: vi.fn(),
  postScopedEncryptedSecret: vi.fn(),
}));

vi.mock("../../../utils/encryptSecretValue", () => ({
  encryptSecretValue: vi.fn(),
}));

const environment: ScopedEnvironment = {
  environmentId: "env-1",
  name: "Staging",
  variables: {},
  scopeType: "workspace",
  scopeId: "ws-1",
  isDefault: false,
  allowedWorkspaceIds: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const DOTENV = [
  "# staging",
  "export BASE_URL=https://staging.test",
  'API_KEY="sk-staging-123"',
  "USER=bob",
  "PORT=8080",
].join("\n");

async function chooseFile(text: string, name = "staging.env"): Promise<void> {
  const input = screen.getByLabelText(/\.env, JSON object or Postman environment/);
  await userEvent.upload(input, new File([text], name, { type: "text/plain" }));
}

function renderDialog(variables: Record<string, string> = {}) {
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(
    <EnvironmentVariablesImportDialog
      isOpen
      environment={environment}
      variables={variables}
      onClose={onClose}
      onImported={onImported}
    />,
  );
  return { onImported, onClose };
}

describe("EnvironmentVariablesImportDialog", () => {
  beforeEach(() => {
    vi.mocked(listScopedSecrets).mockReset().mockResolvedValue([]);
    vi.mocked(fetchScopedPublicKey).mockReset().mockResolvedValue({
      keyId: "key-1",
      publicKey: "cHVibGlj",
      algorithm: "libsodium-sealed-box",
    });
    vi.mocked(postScopedEncryptedSecret).mockReset();
    vi.mocked(encryptSecretValue)
      .mockReset()
      .mockResolvedValue(new Uint8Array([9, 9, 9]));
  });

  it("defaults credential-looking keys to secrets, seals them, and never writes them as variables", async () => {
    const user = userEvent.setup();
    const { onImported } = renderDialog({ USER: "bob" });

    await chooseFile(DOTENV);

    expect(screen.getByRole("checkbox", { name: "Store API_KEY as a secret" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Store BASE_URL as a secret" })).not.toBeChecked();
    expect(screen.queryByText("sk-staging-123")).not.toBeInTheDocument();
    expect(screen.getByText("https://staging.test")).toBeInTheDocument();
    expect(screen.getByText("Unchanged")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import 3" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledWith({
      USER: "bob",
      BASE_URL: "https://staging.test",
      PORT: "8080",
    });
    expect(encryptSecretValue).toHaveBeenCalledWith("sk-staging-123", expect.objectContaining({ keyId: "key-1" }));
    expect(postScopedEncryptedSecret).toHaveBeenCalledWith({
      scopeType: "environment",
      scopeId: "env-1",
      workspaceId: "ws-1",
      name: "API_KEY",
      sealed: new Uint8Array([9, 9, 9]),
      keyId: "key-1",
    });
  });

  it("lets a key be switched between secret and plain variable", async () => {
    const user = userEvent.setup();
    const { onImported } = renderDialog();

    await chooseFile(DOTENV);
    await user.click(screen.getByRole("checkbox", { name: "Store API_KEY as a secret" }));
    await user.click(screen.getByRole("checkbox", { name: "Store PORT as a secret" }));
    await user.click(screen.getByRole("button", { name: "Import 4" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledWith({
      BASE_URL: "https://staging.test",
      API_KEY: "sk-staging-123",
      USER: "bob",
    });
    expect(postScopedEncryptedSecret).toHaveBeenCalledWith(expect.objectContaining({ name: "PORT" }));
    expect(postScopedEncryptedSecret).toHaveBeenCalledOnce();
  });

  it("keeps existing values on conflict unless told to overwrite", async () => {
    const user = userEvent.setup();
    vi.mocked(listScopedSecrets).mockResolvedValue([
      {
        secretId: "s1",
        name: "API_KEY",
        scopeType: "environment",
        scopeId: "env-1",
        keyId: "key-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ]);
    const { onImported } = renderDialog({ BASE_URL: "https://old.test" });

    await chooseFile(DOTENV);
    expect(await screen.findByText("Replaces secret")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Import 2" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(onImported).toHaveBeenCalledWith({
      BASE_URL: "https://old.test",
      USER: "bob",
      PORT: "8080",
    });
    expect(postScopedEncryptedSecret).not.toHaveBeenCalled();
  });

  it("overwrites conflicts when asked", async () => {
    const user = userEvent.setup();
    const { onImported } = renderDialog({ BASE_URL: "https://old.test" });

    await chooseFile(DOTENV);
    await user.click(screen.getByRole("checkbox", { name: /Overwrite existing values/ }));
    await user.click(screen.getByRole("button", { name: "Import 4" }));

    await waitFor(() => expect(onImported).toHaveBeenCalledOnce());
    expect(onImported.mock.calls[0]?.[0]).toMatchObject({ BASE_URL: "https://staging.test" });
  });

  it("reads a Postman environment and reports nested JSON", async () => {
    renderDialog();

    await chooseFile(
      JSON.stringify({ name: "Prod", values: [{ key: "session", value: "abc", type: "secret" }] }),
      "prod.postman_environment.json",
    );
    expect(screen.getByRole("checkbox", { name: "Store session as a secret" })).toBeChecked();

    await chooseFile('{ "db": { "host": "x" } }', "nested.json");
    expect(screen.getByRole("alert")).toHaveTextContent('"db" holds an object');
  });
});
