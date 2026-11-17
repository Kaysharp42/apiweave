import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import GrpcNode from "./GrpcNode";
import type { GrpcNodeProps } from "../../types";

function mount(config: NonNullable<GrpcNodeProps["data"]["config"]>) {
  return render(
    <ReactFlowProvider>
      <GrpcNode id="grpc_1" data={{ config }} />
    </ReactFlowProvider>,
  );
}

/** The ids ReactFlow gives the node's right-hand (source) sockets. */
function sourceHandles(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll(".react-flow__handle-right")].map((handle) => handle.getAttribute("data-handleid"));
}

describe("GrpcNode", () => {
  it("has one unnamed output for a unary call", () => {
    const { container } = mount({ target: "localhost:50051", service: "a.B", method: "Get" });
    expect(sourceHandles(container)).toEqual([null]);
  });

  it("has the ready and complete outputs for a server-streaming call", () => {
    const { container, getByText } = mount({ callType: "server-streaming", target: "localhost:50051", service: "a.B", method: "Watch" });
    expect(sourceHandles(container)).toEqual(["ready", "complete"]);
    expect(getByText("complete")).toBeTruthy();
  });
});
