import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WorkflowCanvas from "../WorkflowCanvas";
import { PaletteProvider } from "../../contexts/PaletteContext";

const seen = vi.hoisted(() => ({ variables: undefined as unknown }));

vi.mock("../../hooks/useScopeContext", () => ({
  useScopeContext: () => ({
    workspaceId: null,
    workspaceSlug: null,
    orgId: null,
    orgSlug: null,
    isReady: false,
  }),
}));

vi.mock("../../contexts/WorkspaceContext", () => ({
  useWorkspace: () => ({
    availableWorkspaces: [],
    currentWorkspace: null,
    currentOrg: null,
    orgs: [],
    switchTo: vi.fn(),
    refresh: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("../../contexts/WorkflowContext", () => ({
  useWorkflow: () => ({
    variables: {},
    availableVariables: { extracted: "from an extractor" },
    registerExtractors: vi.fn(),
    updateVariable: vi.fn(),
    updateVariables: vi.fn(),
    onVariablesDeletedRef: { current: null },
  }),
}));

vi.mock("../../hooks/useMakeStepVariable", () => ({
  useMakeStepVariable: (params: { variables: unknown }) => {
    seen.variables = params.variables;
    return {
      canMake: () => false,
      start: vi.fn(),
      dialog: {
        nodeId: null,
        open: false,
        node: undefined,
        nodes: [],
        variables: {},
        onClose: vi.fn(),
        onSubmit: vi.fn(),
      },
    };
  },
}));

describe("WorkflowCanvas variable suggestions", () => {
  it("counts an extractor's name as taken when making a step variable", () => {
    render(
      <MemoryRouter>
        <PaletteProvider>
          <WorkflowCanvas workflowId="wf1" workflow={null} />
        </PaletteProvider>
      </MemoryRouter>,
    );

    expect(seen.variables).toEqual({ extracted: "from an extractor" });
  });
});
