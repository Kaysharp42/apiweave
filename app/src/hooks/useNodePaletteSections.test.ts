import { describe, expect, it } from "vitest";
import type { Workflow } from "@shared/types/Workflow";
import { importedItemConfig } from "./useNodePaletteSections";
import { createCanvasNode } from "./useCanvasDrop";
import { canvasToWorkflow } from "../adapters/workflowCanvas";

const workflow: Workflow = {
  workflowId: "workflow-1",
  workspaceId: "workspace-1",
  name: "Imported",
  nodes: [],
  edges: [],
  variables: {},
  tags: [],
  collectionId: null,
  selectedEnvironmentId: null,
  nodeTemplates: [],
  rev: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as Workflow;

function dropAndSave(item: Parameters<typeof importedItemConfig>[0]): Workflow {
  const node = createCanvasNode({ type: "http-request", label: "Imported", config: importedItemConfig(item) }, { x: 0, y: 0 });
  return canvasToWorkflow({ nodes: [node], edges: [], variables: {}, selectedEnvironmentId: null }, workflow);
}

describe("an imported request dropped on the canvas", () => {
  it("saves, with the OpenAPI operation and response schemas it was imported with", () => {
    const openapiMeta = { source: "openapi", method: "GET", path: "/orders", operationId: "listOrders", fingerprint: "|GET|/orders|listOrders" };
    const responseSchemas = { "200": { type: "array" } };
    const saved = dropAndSave({ url: "https://shop.test/orders", openapiMeta, responseSchemas });
    expect(saved.nodes[0]?.config).toMatchObject({ openapiMeta, responseSchemas });
  });

  it("saves one imported without OpenAPI metadata", () => {
    expect(() => dropAndSave({ url: "https://shop.test/orders", openapiMeta: null })).not.toThrow();
  });
});
