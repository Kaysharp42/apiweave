import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { MissingRunInputsDialog } from "../MissingRunInputsDialog";
import useMissingRunInputsStore from "../../../stores/MissingRunInputsStore";
import type { RunInputCheck } from "@shared/types/RunInputCheck";
import type { RunInputsRefusal } from "@shared/types/RunInputsRefusal";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("../../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    availableWorkspaces: [{ workspaceId: "ws-1", slug: "qa", name: "QA" }],
    currentOrg: { slug: "acme" },
  }),
}));

const use = { workflowId: "wf-1", workflowName: "Login", nodeId: "n1", nodeLabel: "Sign in" };
const check: RunInputCheck = {
  workspaceId: "ws-1",
  workflowId: "wf-1",
  workflowName: "Login",
  environment: { environmentId: "env-1", name: "Dev" },
  missing: [
    {
      kind: "env",
      name: "BASE_URL",
      reason: "unset",
      storedIn: null,
      usedBy: [use, { ...use, workflowId: "wf-2", workflowName: "Auth", nodeId: "n2", nodeLabel: "Token" }],
    },
    { kind: "env", name: "TENANT", reason: "empty", storedIn: null, usedBy: [use] },
    { kind: "secret", name: "API_KEY", reason: "unset", storedIn: null, usedBy: [use] },
    { kind: "secret", name: "PASSWORD", reason: "empty", storedIn: "environment", usedBy: [use] },
  ],
};
const refusal: RunInputsRefusal = { target: { kind: "workflow", name: "Login" }, checks: [check] };

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function renderDialog() {
  return render(
    <MemoryRouter initialEntries={["/acme/qa/workflows/wf-1"]}>
      <MissingRunInputsDialog />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MissingRunInputsDialog", () => {
  beforeEach(() => {
    act(() => useMissingRunInputsStore.getState().close());
  });

  it("renders nothing until a refused run is shown", () => {
    renderDialog();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names each missing value, whether it is unset or empty, and the steps that read it", async () => {
    renderDialog();
    act(() => useMissingRunInputsStore.getState().show(refusal, null));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("“Login” was not run: it reads environment variables or secrets that are not set or are empty. Nothing was sent.");
    expect(dialog).toHaveTextContent("{{env.BASE_URL}}Not set · used by Sign in, Token (in “Auth”)");
    expect(dialog).toHaveTextContent("{{env.TENANT}}Empty · used by Sign in");
    expect(dialog).toHaveTextContent("{{secrets.API_KEY}}Not set");
    expect(dialog).toHaveTextContent("{{secrets.PASSWORD}}Empty");
  });

  it("says an agent asked, and that it cannot add secrets", async () => {
    renderDialog();
    act(() => useMissingRunInputsStore.getState().show(refusal, "claude-code"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("claude-code tried to run “Login”, but it reads environment variables or secrets");
    expect(dialog).toHaveTextContent("an agent cannot add or read secrets");
  });

  it("lists each workflow of a refused project run under its name", async () => {
    renderDialog();
    const other: RunInputCheck = { ...check, workflowId: "wf-3", workflowName: "Checkout", missing: [check.missing[0]!] };
    act(() =>
      useMissingRunInputsStore.getState().show({ target: { kind: "project", name: "Smoke" }, checks: [check, other] }, null),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("The project “Smoke” was not run: 2 of its workflows read");
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Checkout" })).toBeInTheDocument();
  });

  it("opens the environment's editor for its missing variables", async () => {
    renderDialog();
    act(() => useMissingRunInputsStore.getState().show(refusal, null));

    await userEvent.setup().click(await screen.findByRole("button", { name: "Edit “Dev”" }));

    expect(screen.getByTestId("where")).toHaveTextContent("/acme/qa/settings/environments?edit=env-1");
    expect(useMissingRunInputsStore.getState().shown).toBeNull();
  });

  it("adds an unset secret to the workspace", async () => {
    renderDialog();
    act(() => useMissingRunInputsStore.getState().show(refusal, null));

    await userEvent.setup().click(await screen.findByRole("button", { name: "Add secret" }));

    expect(await screen.findByText("Save API_KEY in the workspace")).toBeInTheDocument();
    expect(screen.getByDisplayValue("API_KEY")).toBeInTheDocument();
  });

  it("fills in an empty secret in the scope that holds it", async () => {
    renderDialog();
    act(() => useMissingRunInputsStore.getState().show(refusal, null));

    await userEvent.setup().click(await screen.findByRole("button", { name: "Set value" }));

    expect(await screen.findByText("Save PASSWORD in environment “Dev”")).toBeInTheDocument();
    expect(screen.getByDisplayValue("PASSWORD")).toBeInTheDocument();
  });
});
