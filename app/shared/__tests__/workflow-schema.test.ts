import { describe, expect, it } from "vitest"
import { z, ZodError } from "zod"
import { BrowserNodeDataSchema } from "../zod-schemas/BrowserNodeDataSchema"
import { WorkflowCallForEachSchema } from "../zod-schemas/WorkflowCallForEachSchema"
import { WorkflowCallNodeDataSchema } from "../zod-schemas/WorkflowCallNodeDataSchema"
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

  it("rejects assertion sources and operators outside the shared closed enums", () => {
    const base = {
      nodeId: "assertion-closed-enums",
      type: "assertion",
      position: { x: 0, y: 0 },
    }

    expect(WorkflowNodeSchema.safeParse({
      ...base,
      config: { assertions: [{ source: "response", path: "body.id", operator: "equals", expectedValue: 1 }] },
    }).success).toBe(false)
    expect(WorkflowNodeSchema.safeParse({
      ...base,
      config: { assertions: [{ source: "prev", path: "body.id", operator: "matchesRegex", expectedValue: ".*" }] },
    }).success).toBe(false)
  })

  it("accepts a canvas-only note", () => {
    expect(WorkflowNodeSchema.safeParse({
      nodeId: "note-1",
      type: "note",
      position: { x: 0, y: 0 },
      config: { content: "Retries begin here." },
    }).success).toBe(true)
  })

  it("accepts bounded SSE finish triggers and requires one for an unlimited timeout", () => {
    const base = {
      nodeId: "sse-1",
      type: "sse",
      position: { x: 0, y: 0 },
    }

    expect(WorkflowNodeSchema.safeParse({
      ...base,
      config: {
        url: "https://example.test/events",
        eventType: "order.updated",
        maxEvents: 2,
        timeout: 30,
        headers: [{ key: "Authorization", value: "Bearer {{secrets.API_TOKEN}}" }],
      },
    }).success).toBe(true)
    expect(WorkflowNodeSchema.safeParse({
      ...base,
      config: {
        url: "https://example.test/events",
        timeout: 0,
        finishConditions: [{ path: "data.status", operator: "equals", expectedValue: "complete" }],
      },
    }).success).toBe(true)
    expect(WorkflowNodeSchema.safeParse({ ...base, config: { timeout: 0 } }).success).toBe(false)
    expect(WorkflowNodeSchema.safeParse({ ...base, config: { maxEvents: 0 } }).success).toBe(false)
  })

  it("accepts a bounded websocket node and rejects unbounded or unknown fields", () => {
    const base = { nodeId: "ws-1", type: "websocket", position: { x: 0, y: 0 } }
    expect(WorkflowNodeSchema.safeParse({
      ...base,
      config: {
        url: "wss://example.test/socket",
        subprotocols: ["chat.v1"],
        messages: [{ data: "{\"action\":\"subscribe\"}", type: "text" }, { data: "AQID", type: "binary", delayMs: 50 }],
        maxMessages: 5,
        finishConditions: [{ path: "$.data.status", operator: "equals", expectedValue: "done" }],
      },
    }).success).toBe(true)
    expect(WorkflowNodeSchema.safeParse({ ...base, config: { timeout: 0 } }).success).toBe(false)
    expect(WorkflowNodeSchema.safeParse({ ...base, config: { maxMessages: 0 } }).success).toBe(false)
    expect(WorkflowNodeSchema.safeParse({ ...base, config: { maxEvents: 1 } }).success).toBe(false)
    expect(WorkflowNodeSchema.safeParse({ ...base, config: { messages: [{ data: "x", type: "json" }] } }).success).toBe(false)
  })
})

describe("WorkflowNodeSchema — grpc node", () => {
  const grpc = (config: unknown) => WorkflowNodeSchema.safeParse({ nodeId: "g", type: "grpc", position: { x: 0, y: 0 }, config })

  it("accepts a unary call with reflection or inline protos", () => {
    expect(grpc({ callType: "unary", target: "localhost:50051", tls: true, service: "a.B", method: "C", message: "{}", metadata: [{ key: "k", value: "v" }], deadline: 5, schemaSource: "reflection", expectedStatus: "NOT_FOUND" }).success).toBe(true)
    expect(grpc({ schemaSource: "proto", protoFiles: { "a.proto": "syntax = \"proto3\";" } }).success).toBe(true)
  })

  it("accepts unary and server-streaming, and rejects unknown fields", () => {
    expect(grpc({ callType: "server-streaming" }).success).toBe(true)
    expect(grpc({ callType: "unary", surprise: 1 }).success).toBe(false)
    expect(grpc({ callType: "bidirectional" }).success).toBe(false)
    expect(grpc({ deadline: 0 }).success).toBe(false)
  })
})

describe("WorkflowNodeSchema — workflow node (Call Workflow)", () => {
  const call = (config: unknown) => WorkflowNodeSchema.safeParse({ nodeId: "call", type: "workflow", position: { x: 0, y: 0 }, config })

  it("accepts a call with a forEach, and stays lenient when the forEach is half-configured", () => {
    expect(call({
      targetWorkflowId: "wf_child",
      inputMapping: { tenant: "{{variables.tenantId}}" },
      outputMapping: { authToken: "accessToken" },
      forEach: { items: "{{variables.ids}}", itemVariable: "id", indexVariable: "i", concurrency: 16, stopOnFailure: false },
    }).success).toBe(true)
    // A half-configured for-each never blocks a save; the runner fails the node
    // with a clear message instead.
    expect(call({ targetWorkflowId: "wf_child", forEach: {} }).success).toBe(true)
  })

  it("bounds concurrency to the range the runner enforces", () => {
    expect(call({ targetWorkflowId: "wf_child", forEach: { items: "[1]", itemVariable: "id", concurrency: 17 } }).success).toBe(false)
    expect(call({ targetWorkflowId: "wf_child", forEach: { items: "[1]", itemVariable: "id", concurrency: 0 } }).success).toBe(false)
  })

  /**
   * A Call Workflow's post-1.0 fields are invisible in tools/list;
   * workflows_nodeSchema is where an agent learns what it accepts, and it
   * showed zero descriptions until every field carried one. The draft-7
   * conversion here is the exact object the MCP handler publishes, so a
   * description on the schema reaches the agent unchanged.
   */
  it("describes every config field and every forEach field in the published schema", () => {
    const configSchema = z.toJSONSchema(WorkflowCallNodeDataSchema, { target: "draft-7", io: "input" }) as {
      properties: Record<string, { description?: string }>
    }
    for (const field of ["targetWorkflowId", "targetWorkflowName", "inputMapping", "outputMapping", "forEach"]) {
      expect(configSchema.properties[field]?.description, field).toBeTruthy()
    }

    const forEachSchema = z.toJSONSchema(WorkflowCallForEachSchema, { target: "draft-7", io: "input" }) as {
      properties: Record<string, { description?: string }>
    }
    for (const field of ["items", "itemVariable", "indexVariable", "concurrency", "stopOnFailure"]) {
      expect(forEachSchema.properties[field]?.description, field).toBeTruthy()
    }
  })
})

describe("WorkflowNodeSchema — browser node", () => {
  const browser = (config: unknown) => WorkflowNodeSchema.safeParse({ nodeId: "b1", type: "browser", position: { x: 0, y: 0 }, config })

  it("accepts the login example from the browser steps plan", () => {
    // The five steps in docs/plans/browser-steps-plan.md § Example.
    const steps = [
      { nodeId: "b1", config: { action: "navigate", url: "{{env.BASE_URL}}/login" } },
      { nodeId: "b2", config: { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value: "{{env.TEST_EMAIL}}" } },
      { nodeId: "b3", config: { action: "fill", locator: { kind: "role", role: "textbox", name: "Password" }, value: "{{secrets.TEST_PASSWORD}}" } },
      { nodeId: "b4", config: { action: "click", locator: { kind: "role", role: "button", name: "Sign in" } } },
      { nodeId: "b5", config: { action: "expect-text", locator: { kind: "role", role: "heading", name: "Dashboard" }, text: "Dashboard", match: "contains" } },
    ]
    for (const step of steps) {
      expect(
        WorkflowNodeSchema.safeParse({ ...step, type: "browser", position: { x: 0, y: 0 } }).success,
        step.nodeId,
      ).toBe(true)
    }
  })

  it("accepts a locator nested two levels inside a frame, with hasText and nth", () => {
    expect(browser({
      action: "click",
      button: "left",
      clickCount: 2,
      modifiers: ["Control", "Shift"],
      dialog: "accept",
      locator: {
        kind: "role",
        role: "button",
        name: "Delete",
        exact: true,
        frame: "iframe[title='embedded']",
        hasText: "Row B",
        nth: -1,
        within: {
          kind: "css",
          value: "table.orders",
          nth: 0,
          within: { kind: "testId", value: "orders-panel" },
        },
      },
    }).success).toBe(true)
    expect(browser({ action: "extract", from: "attribute", attribute: "href", locator: { kind: "css", value: "a.next" }, variable: "next_url" }).success).toBe(true)
    expect(browser({ action: "expect-url", url: "{{env.BASE_URL}}/dashboard", match: "matches" }).success).toBe(true)
    expect(browser({ action: "press", key: "Control+A" }).success).toBe(true)
  })

  it("rejects an unknown action", () => {
    expect(browser({ action: "drag", locator: { kind: "css", value: "#row" } }).success).toBe(false)
  })

  it("rejects an unknown locator kind and an extra field on a member", () => {
    expect(browser({ action: "click", locator: { kind: "xpath", value: "//button" } }).success).toBe(false)
    expect(browser({ action: "click", locator: { kind: "css", value: "#save", surprise: 1 } }).success).toBe(false)
    expect(browser({ action: "hover", locator: { kind: "css", value: "#save" }, surprise: 1 }).success).toBe(false)
  })

  it("rejects an extract that lacks what its from requires", () => {
    expect(browser({ action: "extract", from: "attribute", locator: { kind: "css", value: "a" }, variable: "href" }).success).toBe(false)
    expect(browser({ action: "extract", from: "text", variable: "heading" }).success).toBe(false)
    expect(browser({ action: "extract", from: "url", variable: "url" }).success).toBe(true)
    expect(browser({ action: "extract", from: "title", variable: "title" }).success).toBe(true)
  })

  it("rejects a click without a locator", () => {
    expect(browser({ action: "click" }).success).toBe(false)
  })

  it("converts to the draft-7 JSON Schema that workflows.nodeSchema publishes", () => {
    const jsonSchema = z.toJSONSchema(BrowserNodeDataSchema, { target: "draft-7", io: "input" })
    expect(Array.isArray(jsonSchema["oneOf"])).toBe(true)
    expect(jsonSchema["description"]).toContain("single ordered chain")
  })
})
