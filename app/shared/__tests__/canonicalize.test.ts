import { describe, expect, it } from "vitest"
import {
  canonicalizeSyncPayload,
  IDENTITY_PLACEHOLDER,
  normalizeConflictKind,
} from "../conflict-diff/canonicalize"
import type { JsonValue } from "../types/JsonValue"

describe("normalizeConflictKind", () => {
  it("maps the canonical kinds and the collection alias", () => {
    expect(normalizeConflictKind("workspace")).toBe("workspace")
    expect(normalizeConflictKind("project")).toBe("project")
    expect(normalizeConflictKind("collection")).toBe("project")
    expect(normalizeConflictKind("workflow")).toBe("workflow")
    expect(normalizeConflictKind("environment")).toBe("environment")
  })

  it("returns null for an unknown kind so the diff falls back to generic", () => {
    expect(normalizeConflictKind("robot")).toBeNull()
    expect(normalizeConflictKind("")).toBeNull()
  })
})

describe("canonicalizeSyncPayload — generic behavior", () => {
  it("drops rev and updatedAt for every known kind", () => {
    for (const kind of ["workspace", "project", "workflow", "environment"] as const) {
      const out = canonicalizeSyncPayload(kind, {
        rev: 9,
        updatedAt: "2026-07-09T00:00:00.000Z",
        name: "x",
      })
      expect(out["rev"]).toBeUndefined()
      expect(out["updatedAt"]).toBeUndefined()
      expect(out["name"]).toBe("x")
    }
  })

  it("falls back to the generic transform for an unknown kind and still drops rev", () => {
    const out = canonicalizeSyncPayload("robot", {
      kind: "robot",
      workspaceId: "ws-local",
      rev: 9,
      updatedAt: "2026-07-05T00:00:00.000Z",
      name: "Bender",
    })
    expect(out["name"]).toBe("Bender")
    expect(out["rev"]).toBeUndefined()
    expect(out["updatedAt"]).toBeUndefined()
    // unknown kinds do not neutralize identity fields — they pass through.
    expect(out["workspaceId"]).toBe("ws-local")
  })

  it("returns an empty object for a non-object payload and never throws", () => {
    expect(canonicalizeSyncPayload("workflow", null as unknown as JsonValue)).toEqual({})
    expect(canonicalizeSyncPayload("workflow", "not an object")).toEqual({})
    expect(canonicalizeSyncPayload("workflow", [1, 2, 3])).toEqual({})
  })
})

describe("canonicalizeSyncPayload — workspace", () => {
  it("neutralizes workspaceId and preserves content fields", () => {
    const out = canonicalizeSyncPayload("workspace", {
      workspaceId: "ws-local",
      teamId: "team-1",
      slug: "personal",
      name: "My Workspace",
      isPersonal: true,
      origin: "local",
      syncMode: "bi-directional",
      rev: 5,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-25T01:00:00.000Z",
    })
    expect(out["workspaceId"]).toBe(IDENTITY_PLACEHOLDER)
    expect(out["rev"]).toBeUndefined()
    expect(out["updatedAt"]).toBeUndefined()
    expect(out["name"]).toBe("My Workspace")
    expect(out["teamId"]).toBe("team-1")
  })
})

describe("canonicalizeSyncPayload — project (collection)", () => {
  it("drops the desktop-only workflowOrderItems denormalization", () => {
    const out = canonicalizeSyncPayload("project", {
      collectionId: "col-1",
      workspaceId: "ws-local",
      name: "Local",
      workflowCount: 3,
      workflowOrder: ["a", "b"],
      workflowOrderItems: [{ workflowId: "a" }, { workflowId: "b" }],
      rev: 2,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    })
    expect(out["workflowOrderItems"]).toBeUndefined()
    expect(out["workspaceId"]).toBe(IDENTITY_PLACEHOLDER)
    expect(out["workflowOrder"]).toEqual(["a", "b"])
  })

  it("makes a desktop local copy and a cloud copy canonically equal when content matches", () => {
    const local = canonicalizeSyncPayload("project", {
      collectionId: "col-1",
      workspaceId: "ws-local",
      projectId: "col-1",
      name: "Local",
      workflowCount: 3,
      workflowOrder: ["a", "b"],
      workflowOrderItems: [{ workflowId: "a" }, { workflowId: "b" }],
      continueOnFail: true,
      rev: 2,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-06T00:00:00.000Z",
    })
    const cloud = canonicalizeSyncPayload("project", {
      collectionId: "col-1",
      workspaceId: "ws-cloud",
      projectId: "col-1",
      name: "Local",
      workflowCount: 3,
      workflowOrder: ["a", "b"],
      continueOnFail: true,
      rev: 4,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    })
    expect(local).toEqual(cloud)
  })

  it("surfaces a genuine workflowCount difference", () => {
    const local = canonicalizeSyncPayload("project", { name: "x", workflowCount: 0, workflowOrder: [] })
    const cloud = canonicalizeSyncPayload("project", { name: "x", workflowCount: 1, workflowOrder: [] })
    expect(local).not.toEqual(cloud)
    expect(local["workflowCount"]).toBe(0)
    expect(cloud["workflowCount"]).toBe(1)
  })
})

describe("canonicalizeSyncPayload — workflow", () => {
  it("neutralizes workspaceId and preserves nodes/edges for the semantic diff", () => {
    const out = canonicalizeSyncPayload("workflow", {
      workflowId: "wf-1",
      workspaceId: "ws-local",
      name: "Smoke",
      nodes: [{ nodeId: "n1", type: "start", position: { x: 0, y: 0 } }],
      edges: [{ edgeId: "e1", source: "n1", target: "n2" }],
      variables: { baseUrl: "https://example.test" },
      tags: ["smoke"],
      rev: 7,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z",
    })
    expect(out["workspaceId"]).toBe(IDENTITY_PLACEHOLDER)
    expect(out["rev"]).toBeUndefined()
    expect(out["name"]).toBe("Smoke")
    expect(Array.isArray(out["nodes"])).toBe(true)
    expect((out["nodes"] as unknown[]).length).toBe(1)
  })
})

describe("canonicalizeSyncPayload — environment", () => {
  it("neutralizes workspace-scoped scopeId and the id segment of workspace secret references", () => {
    const out = canonicalizeSyncPayload("environment", {
      environmentId: "env-1",
      workspaceId: "ws-local",
      name: "Dev",
      scopeType: "workspace",
      scopeId: "ws-local",
      secrets: {
        apiKey: { reference: "workspace:ws-local:apiKey" },
        dbPassword: { reference: "project:col-1:dbPassword" },
      },
      rev: 3,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T01:00:00.000Z",
    })
    expect(out["scopeId"]).toBe(IDENTITY_PLACEHOLDER)
    const secrets = out["secrets"] as Record<string, Record<string, string>>
    const apiKey = secrets["apiKey"]
    const dbPassword = secrets["dbPassword"]
    expect(apiKey?.["reference"]).toBe(`workspace:${IDENTITY_PLACEHOLDER}:apiKey`)
    expect(dbPassword?.["reference"]).toBe("project:col-1:dbPassword")
  })

  it("keeps project-scoped scopeId untouched", () => {
    const out = canonicalizeSyncPayload("environment", {
      environmentId: "env-1",
      workspaceId: "ws-local",
      name: "Dev",
      scopeType: "project",
      scopeId: "col-1",
      rev: 3,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T01:00:00.000Z",
    })
    expect(out["scopeId"]).toBe("col-1")
    expect(out["workspaceId"]).toBe(IDENTITY_PLACEHOLDER)
  })

  it("makes a workspace-scoped env canonically equal across local and cloud remaps", () => {
    const local = canonicalizeSyncPayload("environment", {
      environmentId: "env-1",
      workspaceId: "ws-local",
      name: "Dev",
      scopeType: "workspace",
      scopeId: "ws-local",
      secrets: { apiKey: { reference: "workspace:ws-local:apiKey" } },
      rev: 3,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T01:00:00.000Z",
    })
    const cloud = canonicalizeSyncPayload("environment", {
      environmentId: "env-1",
      workspaceId: "ws-cloud",
      name: "Dev",
      scopeType: "workspace",
      scopeId: "ws-cloud",
      secrets: { apiKey: { reference: "workspace:ws-cloud:apiKey" } },
      rev: 3,
      createdAt: "2026-07-05T00:00:00.000Z",
      updatedAt: "2026-07-05T02:00:00.000Z",
    })
    expect(local).toEqual(cloud)
  })
})

describe("canonicalizeSyncPayload — isolation", () => {
  it("never aliases the input object or nested values", () => {
    const input: Record<string, unknown> = {
      nodes: [{ nodeId: "n1" }],
      variables: { a: 1 },
    }
    const out = canonicalizeSyncPayload("workflow", input)
    const nodes = out["nodes"] as unknown as Record<string, unknown>[]
    nodes[0]!["nodeId"] = "mutated"
    ;(out["variables"] as Record<string, unknown>)["a"] = 99
    expect((input["nodes"] as Record<string, unknown>[])[0]!["nodeId"]).toBe("n1")
    expect((input["variables"] as Record<string, unknown>)["a"]).toBe(1)
  })
})