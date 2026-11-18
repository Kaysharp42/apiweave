import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import GrpcNode from "./GrpcNode";
import type { GrpcNodeProps } from "../../types";

const { updateNodeInternals } = vi.hoisted(() => ({ updateNodeInternals: vi.fn() }));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, useUpdateNodeInternals: () => updateNodeInternals };
});

type GrpcConfig = NonNullable<GrpcNodeProps["data"]["config"]>;

function node(config: GrpcConfig) {
  return (
    <ReactFlowProvider>
      <GrpcNode id="grpc_1" data={{ config }} />
    </ReactFlowProvider>
  );
}

/** The ids ReactFlow gives the node's right-hand (source) sockets. */
function sourceHandles(container: HTMLElement): Array<string | null> {
  return [...container.querySelectorAll(".react-flow__handle-right")].map((handle) => handle.getAttribute("data-handleid"));
}

const unary: GrpcConfig = { target: "localhost:50051", service: "a.B", method: "Get" };
const streaming: GrpcConfig = { callType: "server-streaming", target: "localhost:50051", service: "a.B", method: "Watch" };

describe("GrpcNode", () => {
  it("has one unnamed output for a unary call", () => {
    const { container } = render(node(unary));
    expect(sourceHandles(container)).toEqual([null]);
  });

  it("has the ready and complete outputs for a server-streaming call", () => {
    const { container, getByText } = render(node(streaming));
    expect(sourceHandles(container)).toEqual(["ready", "complete"]);
    expect(getByText("complete")).toBeTruthy();
  });

  it("has ReactFlow re-measure its sockets when the call type changes, so rewired edges are drawn", () => {
    const { rerender, container } = render(node(unary));
    updateNodeInternals.mockClear();
    rerender(node({ ...unary, method: "GetMore" }));
    expect(updateNodeInternals).not.toHaveBeenCalled();
    rerender(node(streaming));
    expect(sourceHandles(container)).toEqual(["ready", "complete"]);
    expect(updateNodeInternals).toHaveBeenCalledWith("grpc_1");
  });
});
