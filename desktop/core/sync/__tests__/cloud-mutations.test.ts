import { describe, expect, it } from "vitest"
import type { JsonValue } from "../../../../shared/types/JsonValue"
import type { Workflow } from "../../../../shared/types/Workflow"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import { recordWorkflowUpsert } from "../cloud-mutations"
import type { SyncMutation, SyncProvider } from "../SyncProvider"

describe("cloud mutation payloads", () => {
  it("records workflow upserts without secret-shaped variables or request bodies", () => {
    const provider = new CapturingSyncProvider()
    const workflow: Workflow = {
      workflowId: "workflow-1",
      workspaceId: "workspace-1",
      name: "Secret-safe workflow",
      description: null,
      nodes: [
        {
          nodeId: "start",
          type: "start",
          label: null,
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          nodeId: "http-1",
          type: "http-request",
          label: "Call API",
          position: { x: 100, y: 0 },
          config: {
            method: "POST",
            url: "https://user:password@example.test/resource?api_key=secret-value&page=2",
            body: "{\"password\":\"secret\"}",
            headers: [{ key: "Authorization", value: "Bearer secret" }],
            cookies: [{ key: "theme", value: "eyJhbGciOiJIUzI1NiJ9.payload.signature" }],
            queryParams: [{ key: "filter", value: "sk_live_123456" }],
            formDataEntries: [{ key: "otp", value: "123456", type: "text", active: true }],
          },
        },
      ],
      edges: [{ edgeId: "edge-1", source: "start", target: "http-1", label: null }],
      variables: {
        apiKey: "secret-value",
        session: "opaque-session-value",
        safeName: "visible",
        innocuousName: "Bearer hidden-value",
      },
      tags: [],
      collectionId: null,
      selectedEnvironmentId: null,
      nodeTemplates: [],
      rev: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
    }

    recordWorkflowUpsert(provider, workflow)

    expect(provider.mutations).toHaveLength(1)
    const mutation = provider.mutations[0]
    expect(mutation).toMatchObject({
      workspaceId: "workspace-1",
      kind: RecordKind.WORKFLOW,
      recordId: "workflow-1",
      expectedRev: 2,
      op: ChangeOp.UPSERT,
    })
    const payload = decodePayload(mutation.payload)
    expect(payload["variables"]).toEqual({ safeName: "visible", innocuousName: "" })
    expect(JSON.stringify(payload)).not.toContain("secret-value")
    expect(JSON.stringify(payload)).not.toContain("Bearer secret")
    const nodes = payload["nodes"]
    expect(Array.isArray(nodes)).toBe(true)
    const httpNode = Array.isArray(nodes) ? nodes.find(isHttpNode) : undefined
    expect(httpNode?.config).toMatchObject({
      body: "",
      url: "https://example.test/resource?api_key=&page=2",
      cookies: [{ key: "theme", value: "" }],
      queryParams: [{ key: "filter", value: "" }],
      formDataEntries: [],
    })
  })
})

class CapturingSyncProvider implements SyncProvider {
  public readonly mutations: SyncMutation[] = []

  public recordMutation(mutation: SyncMutation): void {
    this.mutations.push(mutation)
  }

  public async pull(): Promise<void> {}

  public async push(): Promise<void> {}
}

function decodePayload(payload: Uint8Array | null): Record<string, JsonValue> {
  expect(payload).not.toBeNull()
  return JSON.parse(new TextDecoder().decode(payload ?? new Uint8Array())) as Record<string, JsonValue>
}

function isHttpNode(value: unknown): value is { readonly nodeId: string; readonly config?: Record<string, JsonValue> } {
  return typeof value === "object" && value !== null && (value as { nodeId?: unknown }).nodeId === "http-1"
}
