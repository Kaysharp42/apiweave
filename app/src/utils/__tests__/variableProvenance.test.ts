import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { WorkflowCanvasNodeData } from "../../types/WorkflowCanvasNodeData";
import { computeProvenance } from "../variableProvenance";

function node(
  id: string,
  type: string,
  config: Record<string, unknown>,
  label?: string,
): Node<WorkflowCanvasNodeData> {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: label ?? id, config },
  } as Node<WorkflowCanvasNodeData>;
}

describe("computeProvenance", () => {
  it("links an extractor producer to a placeholder consumer", () => {
    const nodes = [
      node("login", "http-request", { extractors: { token: "response.body.token" } }, "Login"),
      node(
        "getUser",
        "http-request",
        { headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }] },
        "Get User",
      ),
    ];
    const map = computeProvenance(nodes);
    expect(map.token).toBeDefined();
    expect(map.token!.producers).toEqual([
      { nodeId: "login", nodeLabel: "Login", path: "response.body.token" },
    ]);
    expect(map.token!.consumers).toEqual([
      { nodeId: "getUser", nodeLabel: "Get User", fields: ["headers"] },
    ]);
  });

  it("records consumers without producers for manual variables", () => {
    const nodes = [
      node("get", "http-request", { url: "https://x.test/{{variables.userId}}" }, "Get"),
    ];
    const map = computeProvenance(nodes);
    expect(map.userId).toBeDefined();
    expect(map.userId!.producers).toEqual([]);
    expect(map.userId!.consumers).toEqual([
      { nodeId: "get", nodeLabel: "Get", fields: ["url"] },
    ]);
  });

  it("ignores non-variable placeholders and nodes without config", () => {
    const nodes = [
      node("start", "start", {}),
      node("get", "http-request", { url: "{{env.BASE}}/{{prev.response.body.id}}" }, "Get"),
    ];
    const map = computeProvenance(nodes);
    expect(Object.keys(map)).toEqual([]);
  });
});