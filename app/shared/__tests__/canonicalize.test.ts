import { describe, expect, it } from "vitest"
import type { JsonValue } from "../types/JsonValue"
import { canonicalizeRecord, recordIdOf, recordNameOf } from "../conflict-diff/canonicalize"

describe("canonicalizeRecord", () => {
  it("writes a workspace in the format's field order", () => {
    const read = canonicalizeRecord("workspace", { description: "API tests", name: "Acme", workspaceId: "ws_01" })

    expect(read).toEqual({ document: { workspaceId: "ws_01", name: "Acme", description: "API tests" } })
    expect(Object.keys((read as { document: object }).document)).toEqual(["workspaceId", "name", "description"])
  })

  it("writes a workflow's nodes parent first and by id, edges by id, and positions rounded", () => {
    const value = {
      workflowId: "wf_1",
      projectId: null,
      name: "Flow",
      edges: [{ edgeId: "e2", source: "n2", target: "n1" }, { edgeId: "e1", source: "n1", target: "n2" }],
      nodes: [
        { nodeId: "n2", type: "delay", position: { x: 10.4, y: 20.6 }, parentId: "g1" },
        { nodeId: "n1", type: "delay", position: { x: 0, y: 0 } },
        { nodeId: "g1", type: "group", position: { x: 5, y: 5 } },
      ],
      tags: ["smoke"],
      variables: {},
      description: "",
      selectedEnvironmentId: null,
      nodeTemplates: [],
    }

    const read = canonicalizeRecord("workflow", value as JsonValue)
    if (!("document" in read)) throw new Error(read.invalid)

    expect((read.document["nodes"] as JsonValue[]).map((node) => (node as { nodeId: string }).nodeId)).toEqual(["g1", "n1", "n2"])
    expect(((read.document["nodes"] as JsonValue[])[2] as { position: object }).position).toEqual({ x: 10, y: 21 })
    expect((read.document["edges"] as JsonValue[]).map((edge) => (edge as { edgeId: string }).edgeId)).toEqual(["e1", "e2"])
    expect(Object.keys(read.document)).toEqual(["workflowId", "projectId", "name", "description", "selectedEnvironmentId", "tags", "variables", "nodes", "edges", "nodeTemplates"])
  })

  it("keeps a variable named __proto__ as data, not as a prototype", () => {
    const variables = JSON.parse('{"__proto__": {"polluted": true}, "name": "x"}') as JsonValue
    const value = {
      workflowId: "wf_1",
      projectId: null,
      name: "Flow",
      description: "",
      selectedEnvironmentId: null,
      tags: [],
      nodeTemplates: [],
      nodes: [],
      edges: [],
      variables,
    }

    const read = canonicalizeRecord("workflow", value as JsonValue)
    if (!("document" in read)) throw new Error(read.invalid)

    expect(Object.keys(read.document["variables"] as object).sort()).toEqual(["__proto__", "name"])
    expect((({} as Record<string, unknown>)["polluted"])).toBeUndefined()
  })

  it("refuses a value that is not the kind of record it claims", () => {
    const read = canonicalizeRecord("project", { projectId: "prj_1", name: "Shop", description: null })

    expect(read).toEqual({ invalid: expect.stringContaining("color") })
  })

  it("refuses an unknown field rather than dropping it", () => {
    const read = canonicalizeRecord("workspace", { workspaceId: "ws_01", name: "Acme", description: null, settings: {} })

    expect(read).toEqual({ invalid: expect.stringContaining("settings") })
  })

  it("reads every kind's id and name from the document it holds", () => {
    const read = canonicalizeRecord("environment", {
      environmentId: "env_1",
      name: "Dev",
      description: null,
      swaggerDocUrl: null,
      isDefault: true,
      variables: { baseUrl: "https://dev.example.test" },
    })
    if (!("document" in read)) throw new Error(read.invalid)

    expect(recordIdOf("environment", read.document)).toBe("env_1")
    expect(recordNameOf(read.document)).toBe("Dev")
  })
})
