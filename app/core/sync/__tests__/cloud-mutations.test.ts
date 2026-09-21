import { describe, expect, it } from "vitest"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Collection } from "@shared/types/Collection"
import type { Workflow } from "@shared/types/Workflow"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import { forbiddenCloudPayloadField } from "../../repositories/CloudSyncRepository"
import { recordCollectionUpsert, recordWorkflowUpsert, sanitizeCloudSnapshotPayload } from "../cloud-mutations"
import type { SyncMutation, SyncProvider } from "../SyncProvider"

describe("cloud mutation payloads", () => {
  it("records workflow upserts with bodies and headers intact, redacting only credential-shaped leaves", () => {
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
            body: "{\"username\":\"admin\",\"password\":\"secret\"}",
            headers: [{ key: "Authorization", value: "Bearer secret" }],
            cookies: [{ key: "theme", value: "eyJhbGciOiJIUzI1NiJ9.payload.signature" }],
            queryParams: [{ key: "filter", value: "sk_live_123456" }],
            formDataEntries: [{ key: "otp", value: "123456", type: "text", active: true }],
          },
        },
        {
          nodeId: "http-2",
          type: "http-request",
          label: "Safe config",
          position: { x: 200, y: 0 },
          config: {
            method: "POST",
            url: "https://example.test/plain",
            body: "{\"user\":\"{{variables.user}}\",\"password\":\"{{secrets.PW}}\",\"note\":\"hello\",\"pair\":{\"key\":\"Authorization\",\"value\":\"Bearer x.1\"}}",
            headers: [
              { key: "Authorization", value: "Bearer {{secrets.TOKEN}}" },
              { key: "X-Custom", value: "hello" },
            ],
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
      nodeTemplates: [{
        config: {
          body: "template-secret-body",
          headers: [{ key: "Authorization", value: "Bearer template-secret" }],
        },
      }],
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
    expect(payload["workflowId"]).toBe("workflow-1")
    expect(payload["workspaceId"]).toBe("workspace-1")
    // apiKey/session keep their key (sensitive names) but lose the literal
    // value; dropping the key outright would orphan any `{{variables.apiKey}}`
    // reference elsewhere in the workflow the next time this record is pulled.
    expect(payload["variables"]).toEqual({ apiKey: "", session: "", safeName: "visible", innocuousName: "" })
    expect(JSON.stringify(payload)).not.toContain("secret-value")
    expect(JSON.stringify(payload)).not.toContain("Bearer secret")
    const nodes = payload["nodes"]
    expect(Array.isArray(nodes)).toBe(true)
    const httpNode = Array.isArray(nodes) ? nodes.find(isHttpNode("http-1")) : undefined
    expect(httpNode?.config).toMatchObject({
      body: "{\n  \"username\": \"admin\",\n  \"password\": \"\"\n}",
      url: "https://example.test/resource?api_key=&page=2",
      cookies: [{ key: "theme", value: "" }],
      queryParams: [{ key: "filter", value: "" }],
      formDataEntries: [{ key: "otp", value: "", type: "text", active: true }],
    })
    const safeNode = Array.isArray(nodes) ? nodes.find(isHttpNode("http-2")) : undefined
    expect(safeNode?.config).toMatchObject({
      body: "{\n  \"user\": \"{{variables.user}}\",\n  \"password\": \"{{secrets.PW}}\",\n  \"note\": \"hello\",\n  \"pair\": {\n    \"key\": \"Authorization\",\n    \"value\": \"\"\n  }\n}",
      headers: [
        { key: "Authorization", value: "Bearer {{secrets.TOKEN}}" },
        { key: "X-Custom", value: "hello" },
      ],
    })
    expect(payload["nodeTemplates"]).toEqual([{
      config: {
        body: "template-secret-body",
        headers: [{ key: "Authorization", value: "" }],
      },
    }])
  })

  it("keeps a sensitive-named variable's key so its {{variables.*}} references don't go dangling", () => {
    const provider = new CapturingSyncProvider()
    const workflow: Workflow = {
      workflowId: "workflow-2",
      workspaceId: "workspace-1",
      name: "Token variable",
      description: null,
      nodes: [],
      edges: [],
      variables: {
        token: "raw-jwt-value-should-be-withheld",
        apiKeyRef: "{{secrets.API_KEY}}",
      },
      tags: [],
      collectionId: null,
      selectedEnvironmentId: null,
      nodeTemplates: [],
      rev: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    recordWorkflowUpsert(provider, workflow)

    const payload = decodePayload(provider.mutations[0].payload)
    // The literal value is withheld, but the `token` key itself survives —
    // dropping it would orphan every `{{variables.token}}` reference in this
    // workflow (and any other) the next time the record is pulled.
    expect(payload["variables"]).toEqual({ token: "", apiKeyRef: "{{secrets.API_KEY}}" })
  })

  it("preserves project workflow-order metadata for cloud round trips", () => {
    const provider = new CapturingSyncProvider()
    const collection: Collection = {
      collectionId: "project-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      name: "Project",
      description: null,
      color: null,
      workflowCount: 1,
      workflowOrder: [{ workflowId: "workflow-1", order: 2, enabled: false, continueOnFail: false }],
      continueOnFail: true,
      rev: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    recordCollectionUpsert(provider, collection)

    const payload = decodePayload(provider.mutations[0]?.payload ?? null)
    expect(payload["workflowOrder"]).toEqual(["workflow-1"])
    expect(payload["workflowOrderItems"]).toEqual(collection.workflowOrder)
  })

  it("preserves references in sensitive config keys, extractors, nested variables and templates", () => {
    const provider = new CapturingSyncProvider()
    const workflow: Workflow = {
      workflowId: "workflow-refs",
      workspaceId: "workspace-1",
      name: "Reference-preserving workflow",
      description: null,
      nodes: [{
        nodeId: "http-1",
        type: "http-request",
        label: null,
        position: { x: 0, y: 0 },
        config: {
          method: "GET",
          url: "https://api.test/run?token={{variables.token}}&password=abc1234",
          token: "{{variables.token}}",
          password: "literal-password",
          apiKey: { key: "X-Api-Key", value: "{{secrets.API_KEY}}", in: "header" },
          extractors: { token: "response.body.token", api_key: "body.api_key" },
          headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }],
          cookies: [
            { key: "session", value: "{{env.SESSION}}" },
            { key: "sid", value: "REAL{{env.SUFFIX}}" },
          ],
        },
      }],
      edges: [],
      variables: {
        token: "{{secrets.PW}}",
        password: "abc1234",
        nested: { password: "{{variables.password}}" },
      },
      tags: [],
      collectionId: null,
      selectedEnvironmentId: null,
      nodeTemplates: [{
        config: {
          token: "{{variables.token}}",
          headers: [{ key: "Authorization", value: "{{secrets.TOKEN}}" }],
        },
      }],
      rev: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    recordWorkflowUpsert(provider, workflow)

    const payload = decodePayload(provider.mutations[0]?.payload ?? null)
    const nodes = payload["nodes"] as Array<Record<string, JsonValue>>
    const config = nodes[0]?.["config"] as Record<string, JsonValue>
    expect(config["token"]).toBe("{{variables.token}}")
    expect(config["password"]).toBe("")
    expect(config["apiKey"]).toEqual({ key: "X-Api-Key", value: "{{secrets.API_KEY}}", in: "header" })
    expect(config["extractors"]).toEqual({ token: "response.body.token", api_key: "body.api_key" })
    expect(config["headers"]).toEqual([{ key: "Authorization", value: "Bearer {{variables.token}}" }])
    expect(config["cookies"]).toEqual([
      { key: "session", value: "{{env.SESSION}}" },
      { key: "sid", value: "" },
    ])
    expect(config["url"]).toBe("https://api.test/run?token={{variables.token}}&password=")
    expect(payload["variables"]).toEqual({
      token: "{{secrets.PW}}",
      password: "",
      nested: { password: "{{variables.password}}" },
    })
    expect(payload["nodeTemplates"]).toEqual([{
      config: {
        token: "{{variables.token}}",
        headers: [{ key: "Authorization", value: "{{secrets.TOKEN}}" }],
      },
    }])
    expect(JSON.stringify(payload)).not.toContain("abc1234")
    expect(JSON.stringify(payload)).not.toContain("literal-password")
    expect(forbiddenCloudPayloadField(payload)).toBeUndefined()
  })

  it("keeps references when a pulled payload is re-sanitized into a snapshot", () => {
    const input = {
      workflowId: "workflow-1",
      variables: { token: "{{variables.token}}", password: "abc1234" },
      nodes: [{
        nodeId: "http-1",
        config: {
          token: "{{variables.token}}",
          extractors: { token: "response.body.token" },
          headers: [{ key: "Authorization", value: "Bearer {{variables.token}}" }],
        },
      }],
      nodeTemplates: [{ config: { token: "{{secrets.T}}" } }],
    }
    const sanitized = JSON.parse(
      new TextDecoder().decode(sanitizeCloudSnapshotPayload(new TextEncoder().encode(JSON.stringify(input)))),
    ) as Record<string, unknown>

    expect(sanitized["variables"]).toEqual({ token: "{{variables.token}}", password: "" })
    const node = (sanitized["nodes"] as Array<Record<string, unknown>>)[0]!
    const config = node["config"] as Record<string, unknown>
    expect(config["token"]).toBe("{{variables.token}}")
    expect(config["extractors"]).toEqual({ token: "response.body.token" })
    expect(config["headers"]).toEqual([{ key: "Authorization", value: "Bearer {{variables.token}}" }])
    expect(sanitized["nodeTemplates"]).toEqual([{ config: { token: "{{secrets.T}}" } }])
    expect(JSON.stringify(sanitized)).not.toContain("abc1234")
  })

  it("drops forbidden vault storage fields from a push so the fail-closed guard passes", () => {
    const provider = new CapturingSyncProvider()
    const workflow: Workflow = {
      workflowId: "workflow-vault",
      workspaceId: "workspace-1",
      name: "Vault fields",
      description: null,
      nodes: [{
        nodeId: "http-1",
        type: "http-request",
        label: null,
        position: { x: 0, y: 0 },
        config: {
          method: "GET",
          ciphertext: "vault-blob",
          private_key: "vault-key",
          token: "{{variables.token}}",
        },
      }],
      edges: [],
      variables: {
        ciphertext: "vault-blob",
        plaintext: "vault-plain",
        password: "{{variables.password}}",
      },
      tags: [],
      collectionId: null,
      selectedEnvironmentId: null,
      nodeTemplates: [],
      rev: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    // The old walker kept the vault field blanked and `assertNoSecretValues`
    // threw inside recordWorkflowUpsert; these keys must be gone entirely.
    recordWorkflowUpsert(provider, workflow)

    const payload = decodePayload(provider.mutations[0]?.payload ?? null)
    expect(payload["variables"]).toEqual({ password: "{{variables.password}}" })
    const config = (payload["nodes"] as Array<Record<string, JsonValue>>)[0]?.["config"] as Record<string, JsonValue>
    expect(config["ciphertext"]).toBeUndefined()
    expect(config["private_key"]).toBeUndefined()
    expect(config["token"]).toBe("{{variables.token}}")
    expect(JSON.stringify(payload)).not.toContain("vault-blob")
    expect(JSON.stringify(payload)).not.toContain("vault-plain")
    expect(forbiddenCloudPayloadField(payload)).toBeUndefined()
  })

  it("withholds a credential-shaped extractor value while keeping valid response paths", () => {
    const provider = new CapturingSyncProvider()
    const workflow: Workflow = {
      workflowId: "workflow-extractors",
      workspaceId: "workspace-1",
      name: "Extractors",
      description: null,
      nodes: [{
        nodeId: "http-1",
        type: "http-request",
        label: null,
        position: { x: 0, y: 0 },
        config: {
          method: "GET",
          extractors: { token: "response.body.token", bad: "Bearer abc.123" },
        },
      }],
      edges: [],
      variables: {},
      tags: [],
      collectionId: null,
      selectedEnvironmentId: null,
      nodeTemplates: [],
      rev: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    recordWorkflowUpsert(provider, workflow)

    const payload = decodePayload(provider.mutations[0]?.payload ?? null)
    const config = (payload["nodes"] as Array<Record<string, JsonValue>>)[0]?.["config"] as Record<string, JsonValue>
    expect(config["extractors"]).toEqual({ token: "response.body.token", bad: "" })
    expect(JSON.stringify(payload)).not.toContain("Bearer abc.123")
    expect(forbiddenCloudPayloadField(payload)).toBeUndefined()
  })

  it("redacts a literal in a templated base URL and a duplicate query parameter", () => {
    const provider = new CapturingSyncProvider()
    const workflow: Workflow = {
      workflowId: "workflow-template-url",
      workspaceId: "workspace-1",
      name: "Template URL",
      description: null,
      nodes: [{
        nodeId: "http-1",
        type: "http-request",
        label: null,
        position: { x: 0, y: 0 },
        config: {
          method: "GET",
          url: "{{env.BASE_URL}}/login?password={{variables.p}}&password=abc1234",
        },
      }],
      edges: [],
      variables: {},
      tags: [],
      collectionId: null,
      selectedEnvironmentId: null,
      nodeTemplates: [],
      rev: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    recordWorkflowUpsert(provider, workflow)

    const payload = decodePayload(provider.mutations[0]?.payload ?? null)
    const config = (payload["nodes"] as Array<Record<string, JsonValue>>)[0]?.["config"] as Record<string, JsonValue>
    expect(config["url"]).toBe("{{env.BASE_URL}}/login?password={{variables.p}}&password=")
    expect(JSON.stringify(payload)).not.toContain("abc1234")
    expect(forbiddenCloudPayloadField(payload)).toBeUndefined()
  })

  it("drops vault fields when a pulled payload is re-sanitized into a snapshot", () => {
    const input = {
      variables: { ciphertext: "vault-blob", token: "{{variables.t}}" },
      nodes: [{ config: { plaintext: "vault-plain", url: "https://api.test/x" } }],
    }
    const sanitized = JSON.parse(
      new TextDecoder().decode(sanitizeCloudSnapshotPayload(new TextEncoder().encode(JSON.stringify(input)))),
    ) as Record<string, unknown>

    expect(sanitized["variables"]).toEqual({ token: "{{variables.t}}" })
    const config = (sanitized["nodes"] as Array<Record<string, unknown>>)[0]?.["config"] as Record<string, unknown>
    expect(config["plaintext"]).toBeUndefined()
    expect(JSON.stringify(sanitized)).not.toContain("vault-")
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

function isHttpNode(nodeId: string): (value: unknown) => boolean {
  return (value: unknown): boolean =>
    typeof value === "object" && value !== null && (value as { nodeId?: unknown }).nodeId === nodeId
}
