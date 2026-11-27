import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import WorkflowContext from "../contexts/WorkflowContext";
import type { WorkflowContextValue } from "../types/WorkflowContextValue";
import { useTemplateSuggestions } from "./useTemplateSuggestions";

vi.mock("./useSecretNamesInScope", () => ({
  useSecretNamesInScope: () => ({ names: [], environmentId: undefined }),
}));

function wrapperWith(value: Partial<WorkflowContextValue>) {
  return ({ children }: { children: ReactNode }) => (
    <WorkflowContext.Provider value={value as WorkflowContextValue}>
      {children}
    </WorkflowContext.Provider>
  );
}

describe("useTemplateSuggestions", () => {
  it("offers names an extractor produces, not only the stored variables", () => {
    const { result } = renderHook(() => useTemplateSuggestions(), {
      wrapper: wrapperWith({ variables: {}, availableVariables: { orderId: "42" } }),
    });

    expect(result.current).toContainEqual(
      expect.objectContaining({ insert: "variables.orderId", kind: "variable" }),
    );
  });
});
