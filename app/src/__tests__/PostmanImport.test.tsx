import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CollectionExportImport } from "../components/CollectionExportImport";
import type { PostmanImportPreview } from "@shared/types/PostmanImportPreview";
import type { PostmanImportResult } from "@shared/types/PostmanImportResult";
import type { ScopeContext } from "../types";

type TestIpcBridge = NonNullable<Window["__APIWEAVE_IPC__"]>;

const mockScope = vi.hoisted(
  (): ScopeContext => ({
    workspaceId: "ws-1",
    workspaceSlug: "personal",
    orgId: null,
    orgSlug: null,
    isReady: true,
  }),
);

vi.mock("../hooks/useScopeContext", () => ({
  useScopeContext: () => mockScope,
}));

const collection = {
  info: {
    name: "Shop API",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [{ name: "Health", request: { method: "GET", url: "{{baseUrl}}/health" } }],
};

const preview: PostmanImportPreview = {
  projectName: "Shop API",
  workflows: [
    { name: "Shop API", requestCount: 1 },
    { name: "Orders / Admin", requestCount: 3 },
  ],
  environment: { name: "Postman: Shop API", variableCount: 2 },
  requiredSecrets: [{ name: "LOGIN_PASSWORD", usedBy: "Login password" }],
  warnings: ["Dynamic variable {{$randomFirstName}} has no APIWeave equivalent; it is left as is"],
};

const result: PostmanImportResult = {
  projectId: "proj-9",
  workflowCount: 2,
  environmentCount: 1,
  requiredSecrets: preview.requiredSecrets,
  missingSecrets: ["LOGIN_PASSWORD"],
  warnings: [],
};

function installBridge(): ReturnType<typeof vi.fn<TestIpcBridge["invoke"]>> {
  const invoke = vi.fn<TestIpcBridge["invoke"]>(async (domain, action) => ({
    ok: true,
    data:
      `${domain}.${action}` === "projects.previewPostman"
        ? preview
        : `${domain}.${action}` === "projects.importPostman"
          ? result
          : { items: [], total: 0 },
  }));
  vi.stubGlobal("__APIWEAVE_IPC__", {
    invoke,
    onRunProgress: () => () => undefined,
  });
  return invoke;
}

describe("Postman import tab", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews a collection, lists workflows, secrets and warnings, then imports it as a new project", async () => {
    const user = userEvent.setup();
    const invoke = installBridge();
    render(
      <CollectionExportImport isOpen onClose={vi.fn()} mode="import-postman" />,
    );

    expect(screen.getByRole("button", { name: /import as new project/i })).toBeDisabled();
    await user.upload(
      screen.getByLabelText(/postman collection \(v2\.1\)/i),
      new File([JSON.stringify(collection)], "shop.postman_collection.json", { type: "application/json" }),
    );
    await user.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("projects", "previewPostman", {
        workspaceId: "ws-1",
        collection,
        mode: "folder",
      });
    });
    expect(await screen.findByText("Orders / Admin")).toBeInTheDocument();
    expect(screen.getByText("3 request(s)")).toBeInTheDocument();
    expect(screen.getByText("LOGIN_PASSWORD")).toBeInTheDocument();
    expect(screen.getByText(/randomFirstName/)).toBeInTheDocument();
    expect(screen.getByLabelText(/project name/i)).toHaveValue("Shop API");

    await user.click(screen.getByRole("button", { name: /import as new project/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("projects", "importPostman", {
        workspaceId: "ws-1",
        collection,
        mode: "folder",
        projectName: "Shop API",
      });
    });
    expect(await screen.findByText(/created a project with 2 workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/create these secrets before running it: LOGIN_PASSWORD/i)).toBeInTheDocument();
  });

  it("says so when the picked file is not JSON, without calling the import", async () => {
    const user = userEvent.setup();
    const invoke = installBridge();
    render(
      <CollectionExportImport isOpen onClose={vi.fn()} mode="import-postman" />,
    );

    await user.upload(
      screen.getByLabelText(/postman collection \(v2\.1\)/i),
      new File(["not json"], "broken.json", { type: "application/json" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("broken.json is not valid JSON");
    expect(screen.getByRole("button", { name: /preview/i })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("projects", "previewPostman", expect.anything());
  });
});
