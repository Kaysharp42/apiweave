import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { describe, expect, it } from "vitest";
import { PaletteProvider } from "./PaletteContext";
import WorkflowContext, { WorkflowProvider, useWorkflow } from "./WorkflowContext";

type Captured = NonNullable<React.ContextType<typeof WorkflowContext>>;

const initialWorkflow = { variables: { manual: "kept" }, collectionId: null };

/** Re-renders itself — and so the provider and the probe — on `bump`. */
function Harness({
  seen,
  onBump,
}: {
  seen: Captured[];
  onBump: (bump: () => void) => void;
}) {
  const [count, setCount] = useState(0);
  onBump(() => setCount((n) => n + 1));
  return (
    <PaletteProvider>
      <span data-count={count} />
      <WorkflowProvider workflowId="wf-1" initialWorkflow={initialWorkflow}>
        <Probe seen={seen} />
      </WorkflowProvider>
    </PaletteProvider>
  );
}

function Probe({ seen }: { seen: Captured[] }) {
  seen.push(useWorkflow());
  return null;
}

async function mount(seen: Captured[], wrap = false) {
  let bump: () => void = () => {};
  const tree = <Harness seen={seen} onBump={(next) => (bump = next)} />;
  render(wrap ? <StrictMode>{tree}</StrictMode> : tree);
  // No active workspace, so the mount-time collection fetch settles at once.
  await waitFor(() => expect(seen.at(-1)?.isLoadingCollections).toBe(false));
  return () => act(() => bump());
}

describe("WorkflowProvider", () => {
  it("keeps the context value referentially stable across an unrelated re-render", async () => {
    const seen: Captured[] = [];
    const rerenderParent = await mount(seen);
    const before = seen.at(-1);
    const renders = seen.length;

    rerenderParent();

    expect(seen.length).toBeGreaterThan(renders);
    expect(seen.at(-1)).toBe(before);
  });

  it("keeps extractor variables out of the persisted variables, and offers them alongside", async () => {
    const seen: Captured[] = [];
    // StrictMode runs reducers twice: a reducer that mutated a ref dropped
    // the second registration's result.
    await mount(seen, true);
    const persisted = seen.at(-1)?.variables;

    act(() => seen.at(-1)?.registerExtractors({ token: "$.token" }));
    // The same object: a save, the history and the live-update comparison
    // all read `variables`, and none of them may see a derived name.
    expect(seen.at(-1)?.variables).toBe(persisted);
    expect(seen.at(-1)?.availableVariables).toEqual({
      manual: "kept",
      token: "$.token",
    });

    act(() => seen.at(-1)?.registerExtractors({ id: "$.id" }));
    expect(seen.at(-1)?.variables).toBe(persisted);
    expect(seen.at(-1)?.availableVariables).toEqual({
      manual: "kept",
      id: "$.id",
    });
  });

  it("applies functional updates to the latest state", async () => {
    const seen: Captured[] = [];
    await mount(seen);
    const { setVariables } = seen.at(-1)!;

    act(() => {
      setVariables((prev) => ({ ...prev, a: 1 }));
      setVariables((prev) => ({ ...prev, b: 2 }));
    });

    expect(seen.at(-1)?.variables).toEqual({ manual: "kept", a: 1, b: 2 });
  });
});
