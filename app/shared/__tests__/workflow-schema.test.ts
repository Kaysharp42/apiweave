import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import { WorkflowNodeSchema } from "../zod-schemas/WorkflowNodeSchema"
import { WorkflowSchema } from "../zod-schemas/WorkflowSchema"

const workflowFixture = {
  workflowId: "01JY0000000000000000000001",
  workspaceId: "01JY0000000000000000000002",
  name: "Smoke workflow",
  description: "Representative local workflow",
  nodes: [
    {
      nodeId: "01JY0000000000000000000003",
      type: "start",
      label: "Start",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      nodeId: "01JY0000000000000000000004",
      type: "http-request",
      label: "Fetch",
      position: { x: 240, y: 0 },
      config: {
        method: "GET",
        url: "https://example.test/health",
        timeout: 30,
        followRedirects: true,
        extractors: { token: "$.token" },
      },
    },
    {
      nodeId: "01JY0000000000000000000005",
      type: "assertion",
      label: "Assert status",
      position: { x: 480, y: 0 },
      config: {
        assertions: [{ source: "status", path: "", operator: "equals", expectedValue: 200 }],
      },
    },
    {
      nodeId: "01JY0000000000000000000006",
      type: "end",
      label: "End",
      position: { x: 720, y: 0 },
      config: {},
    },
  ],
  edges: [
    {
      edgeId: "01JY0000000000000000000007",
      source: "01JY0000000000000000000003",
      target: "01JY0000000000000000000004",
    },
    {
      edgeId: "01JY0000000000000000000008",
      source: "01JY0000000000000000000004",
      target: "01JY0000000000000000000005",
    },
    {
      edgeId: "01JY0000000000000000000009",
      source: "01JY0000000000000000000005",
      target: "01JY0000000000000000000006",
    },
  ],
  variables: { baseUrl: "https://example.test" },
  tags: ["smoke"],
  collectionId: "01JY0000000000000000000010",
  selectedEnvironmentId: "01JY0000000000000000000011",
  nodeTemplates: [],
  rev: 1,
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
}

describe("WorkflowSchema", () => {
  it("parses representative workflow data", () => {
    const parsed = WorkflowSchema.parse(workflowFixture)

    expect(parsed.workflowId).toBe("01JY0000000000000000000001")
  })

  it("rejects malformed revision and missing id", () => {
    const corrupted = { ...workflowFixture, workflowId: undefined, rev: "1" }
    const result = WorkflowSchema.safeParse(corrupted)

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error("corrupted workflow parsed")
    }

    expect(result.error).toBeInstanceOf(ZodError)
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["workflowId", "rev"]),
    )
  })

  // Regression: assertion nodes saved from either renderer editor round-trip
  // through the persistence boundary. Both editors emit source/path/operator/
  // expectedValue plus continueOnFail/failureMode; a stale schema used to
  // reject this shape, silently failing autosave.
  it("accepts assertion config produced by the renderer editors", () => {
    const node = {
      nodeId: "01JY0000000000000000000099",
      type: "assertion",
      label: "Assert",
      position: { x: 0, y: 0 },
      config: {
        assertions: [
          { source: "status", path: "", operator: "equals", expectedValue: "200" },
          { source: "prev", path: "response.body.id", operator: "exists", expectedValue: "" },
          { source: "prev", path: "response.body.items", operator: "count", expectedValue: "3" },
          { source: "prev", path: "response.body.name", operator: "notContains", expectedValue: "x" },
        ],
        continueOnFail: true,
        failureMode: "all",
      },
    }

    expect(WorkflowNodeSchema.safeParse(node).success).toBe(true)
  })
})
