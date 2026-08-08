import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "reactflow";
import StartNode from "./StartNode";
import EndNode from "./EndNode";

/**
 * `start` and `end` execute nothing, but control still passes through them and
 * the runner reports them like any other node — the entry point the moment a
 * run begins, an end node when a branch reaches it.
 *
 * Both used to be pinned to `idle`, which made them the only two nodes on a
 * finished canvas still showing nothing: the run visibly ran through Start and
 * out to End, and neither said so.
 */
describe("terminal nodes report the run", () => {
  const mount = (ui: ReactElement) =>
    render(<ReactFlowProvider>{ui}</ReactFlowProvider>);

  it("stays idle until a run reaches it", () => {
    mount(<StartNode id="start_1" />);
    expect(screen.getByLabelText("Node status: Idle")).toBeTruthy();
  });

  it("takes the entry point's status from the canvas", () => {
    mount(<StartNode id="start_1" data={{ executionStatus: "success" }} />);

    expect(screen.getByLabelText("Node status: Success")).toBeTruthy();
    // Identity survives the status change. `BaseNode` drops the rest line the
    // moment a node has run and shows the run strip instead, and a terminal
    // node has nothing to report beyond having been reached — so the strip is
    // that same line rather than a blank slab.
    expect(screen.getByText("entry point")).toBeTruthy();
  });

  it("takes the end node's status from the canvas", () => {
    mount(<EndNode id="end_1" data={{ executionStatus: "success" }} />);

    expect(screen.getByLabelText("Node status: Success")).toBeTruthy();
    expect(screen.getByText("final step")).toBeTruthy();
  });
});
