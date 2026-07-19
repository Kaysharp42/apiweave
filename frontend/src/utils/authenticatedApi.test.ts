import { describe, expect, test, vi, beforeEach } from "vitest";
import { authenticatedFetch, copyInviteLink } from "./apiweaveClient";

describe("apiweave IPC legacy transport shim", () => {
  beforeEach(() => {
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { items: [], total: 0 } }),
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });
  });

  test("authenticatedFetch returns a Response backed by IPC data", async () => {
    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/workflows",
    );
    await expect(response.json()).resolves.toEqual({ workflows: [], total: 0 });
  });

  test("PUT workspace environment maps to environments.update", async () => {
    const environment = {
      environmentId: "env-1",
      workspaceId: "ws-1",
      name: "dev",
    };
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: environment });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });

    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/environments/env-1",
      {
        method: "PUT",
        body: JSON.stringify({ name: "dev", variables: { AUTH_EMAIL: "admin@kyra.local" } }),
      },
    );

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual(environment);
    expect(invoke).toHaveBeenCalledWith("environments", "update", {
      workspaceId: "ws-1",
      environmentId: "env-1",
      name: "dev",
      variables: { AUTH_EMAIL: "admin@kyra.local" },
    });
  });

  test("GET all-accessible environments maps to environments.list", async () => {
    const environment = {
      environmentId: "env-1",
      workspaceId: "ws-1",
      name: "dev",
    };
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      data: { items: [environment], total: 1 },
    });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });

    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/environments/all-accessible",
    );

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      environments: [environment],
      total: 1,
    });
    expect(invoke).toHaveBeenCalledWith("environments", "list", {
      workspaceId: "ws-1",
    });
  });

  test("workflow import route preserves IPC request wrapper", async () => {
    const bundle = {
      workflow: {
        name: "Imported workflow",
        nodes: [],
        edges: [],
        variables: {},
      },
    };
    const importResult = {
      workflowId: "wf-1",
      name: "Imported workflow",
      nodeCount: 0,
      edgeCount: 0,
      secretReferences: [],
      warnings: [],
    };
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: importResult });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });

    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/workflows/import",
      {
        method: "POST",
        body: JSON.stringify({
          bundle,
          createMissingEnvironments: true,
          sanitize: true,
        }),
      },
    );

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual(importResult);
    expect(invoke).toHaveBeenCalledWith("workflows", "import", {
      workspaceId: "ws-1",
      bundle,
      createMissingEnvironments: true,
      sanitize: true,
    });
  });

  test("project import unwraps the bundle and preserves import options", async () => {
    const bundle = {
      schemaVersion: "2.0",
      type: "awecollection",
      project: { projectId: "source", name: "Imported project", description: "", color: "#123456" },
      workflows: [],
      environments: [],
      secretReferences: [],
      metadata: {
        exportedAt: "2026-01-01T00:00:00.000Z",
        schemaVersion: "2.0",
        workflowCount: 0,
        environmentCount: 0,
        secretReferenceCount: 0,
      },
    };
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      data: { projectId: "target", workflowCount: 0 },
    });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });

    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/projects/import",
      {
        method: "POST",
        body: JSON.stringify({
          bundle,
          createNewProject: false,
          targetProjectId: "target",
        }),
      },
    );

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("projects", "import", {
      workspaceId: "ws-1",
      bundle,
      targetProjectId: "target",
    });
  });

  test("project export forwards the include-environments option", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, data: { workflows: [], environments: [] } });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });

    const response = await authenticatedFetch(
      "ipc://apiweave/api/workspaces/ws-1/projects/project-1/export?include_environment=false",
    );

    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("projects", "export", {
      workspaceId: "ws-1",
      projectId: "project-1",
      includeEnvironments: false,
    });
  });

  test("copyInviteLink reports unavailable clipboard", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyInviteLink("https://example.test/invite")).resolves.toBe(
      false,
    );
  });
});

describe("secrets scope routes", () => {
  const secretMeta = {
    secretId: "sec-1",
    name: "API_KEY",
    scopeType: "workspace",
    scopeId: "ws-1",
    keyId: "key-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };

  function mockIpc(data: unknown) {
    const invoke = vi.fn().mockImplementation((domain: string, action: string) => {
      if (domain === "secrets" && action === "publicKey")
        return Promise.resolve({
          ok: true,
          data: {
            keyId: "key-1",
            publicKey: "abc123",
            algorithm: "libsodium-sealed-box",
          },
        });
      if (domain === "secrets" && action === "set")
        return Promise.resolve({ ok: true, data: secretMeta });
      if (domain === "secrets" && action === "list")
        return Promise.resolve({ ok: true, data });
      if (domain === "secrets" && action === "delete")
        return Promise.resolve({ ok: true, data: null });
      return Promise.resolve({ ok: true, data: { items: [], total: 0 } });
    });
    vi.stubGlobal("__APIWEAVE_IPC__", {
      invoke,
      onRunProgress: vi.fn().mockReturnValue(() => undefined),
    });
    return invoke;
  }

  test("GET /api/scopes/:type/:id/secrets wraps bare IPC array into { secrets, total }", async () => {
    mockIpc([secretMeta]);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/scopes/workspace/ws-1/secrets",
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      secrets: [secretMeta],
      total: 1,
    });
  });

  test("GET secrets list with empty IPC array returns { secrets: [], total: 0 }", async () => {
    mockIpc([]);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/scopes/environment/env-5/secrets",
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({ secrets: [], total: 0 });
  });

  test("GET /api/secrets/public-key maps to secrets.publicKey", async () => {
    const invoke = mockIpc(null);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/secrets/public-key?scope=workspace&id=ws-1",
    );
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({
      keyId: "key-1",
      publicKey: "abc123",
      algorithm: "libsodium-sealed-box",
    });
    expect(invoke).toHaveBeenCalledWith("secrets", "publicKey", {
      workspaceId: "ws-1",
      scopeType: "workspace",
      scopeId: "ws-1",
    });
  });

  test("environment public-key route preserves workspaceId for authorization", async () => {
    const invoke = mockIpc(null);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/secrets/public-key?scope=environment&id=env-1&workspaceId=ws-1",
    );
    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("secrets", "publicKey", {
      workspaceId: "ws-1",
      scopeType: "environment",
      scopeId: "env-1",
    });
  });

  test("unknown secrets route stays 404", async () => {
    mockIpc(null);
    const response = await authenticatedFetch("ipc://apiweave/api/secrets/nope");
    expect(response.status).toBe(404);
  });

  test("POST /api/scopes/:type/:id/secrets maps ciphertext to secrets.set", async () => {
    const invoke = mockIpc(null);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/scopes/workspace/ws-1/secrets",
      {
        method: "POST",
        body: JSON.stringify({
          name: "API_KEY",
          ciphertext: btoa("sealed"),
          keyId: "key-1",
        }),
      },
    );
    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith("secrets", "set", {
      workspaceId: "ws-1",
      name: "API_KEY",
      scopeType: "workspace",
      scopeId: "ws-1",
      keyId: "key-1",
      sealed: Uint8Array.from([115, 101, 97, 108, 101, 100]),
    });
  });

  test("environment secret POST preserves workspaceId for authorization", async () => {
    const invoke = mockIpc(null);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/scopes/environment/env-1/secrets?workspaceId=ws-1",
      {
        method: "POST",
        body: JSON.stringify({
          name: "API_KEY",
          ciphertext: btoa("sealed"),
          keyId: "key-1",
        }),
      },
    );
    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "secrets",
      "set",
      expect.objectContaining({ workspaceId: "ws-1", scopeType: "environment", scopeId: "env-1" }),
    );
  });

  test("secret POST accepts url-safe ciphertext without padding", async () => {
    const invoke = mockIpc(null);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/scopes/workspace/ws-1/secrets",
      {
        method: "POST",
        body: JSON.stringify({
          name: "API_KEY",
          ciphertext: "--8",
          keyId: "key-1",
        }),
      },
    );
    expect(response.ok).toBe(true);
    expect(invoke).toHaveBeenCalledWith(
      "secrets",
      "set",
      expect.objectContaining({ sealed: Uint8Array.from([251, 239]) }),
    );
  });

  test("DELETE /api/scopes/:type/:id/secrets/:id returns 204 no content", async () => {
    mockIpc(null);
    const response = await authenticatedFetch(
      "ipc://apiweave/api/scopes/workspace/ws-1/secrets/sec-1",
      { method: "DELETE" },
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });
});
