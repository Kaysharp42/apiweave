import { describe, expect, it } from "vitest"
import { callerSuppliedVariableNames, placeholderReferences, scriptReferences, variableWrites } from "../variable_references"

describe("placeholderReferences", () => {
  it("captures the scope, the root name and the path after it", () => {
    expect(placeholderReferences("{{variables.case.title}}/{{ env.BASE }}/{{data.rows[0].id}}/{{secrets.KEY}}/{{variables.a[1][2]}}")).toEqual([
      { scope: "variables", name: "case", path: ".title" },
      { scope: "env", name: "BASE", path: "" },
      { scope: "data", name: "rows", path: "[0].id" },
      { scope: "secrets", name: "KEY", path: "" },
      { scope: "variables", name: "a", path: "[1][2]" },
    ])
  })

  it("ignores node results, functions and malformed names", () => {
    expect(placeholderReferences("{{login.response.body.id}} {{uuid()}} {{variables.1x}} {{variables.}}")).toEqual([])
  })
})

describe("scriptReferences", () => {
  it("reads literal-named get and set calls, including the JSON-escaped quote form", () => {
    expect(scriptReferences('aw.variables.set(\\"next\\", 1); aw.env.get(`REGION`); aw.secrets.get("KEY"); aw.variables.set(name, 2)')).toEqual([
      { scope: "variables", name: "next", write: true },
      { scope: "env", name: "REGION", write: false },
      { scope: "secrets", name: "KEY", write: false },
    ])
  })
})

describe("variableWrites", () => {
  it("lists extractors, a Call Workflow's outputMapping, a browser extract and script sets once each", () => {
    expect(variableWrites({ nodeId: "h", type: "http-request", config: {
      extractors: { id: "response.body.id" },
      scripts: { preRequest: 'aw.variables.set("stamp", 1)', postResponse: 'aw.variables.set("stamp", 2); aw.variables.set("next", 3)' },
    } })).toEqual([
      { name: "id", field: "extractors", path: "response.body.id" },
      { name: "stamp", field: "scripts", path: "scripts.preRequest" },
      { name: "next", field: "scripts", path: "scripts.postResponse" },
    ])
    expect(variableWrites({ nodeId: "c", type: "workflow", config: { outputMapping: { token: "accessToken" } } })).toEqual([
      { name: "token", field: "outputMapping", path: "accessToken" },
    ])
    expect(variableWrites({ nodeId: "b", type: "browser", config: { action: "extract", variable: "total" } })).toEqual([
      { name: "total", field: "variable", path: "page.text" },
    ])
  })
})

describe("callerSuppliedVariableNames", () => {
  it("names the inputMapping keys and forEach variables of the nodes that call the target", () => {
    const nodes = [
      { nodeId: "a", type: "workflow", config: { targetWorkflowId: "child", inputMapping: { tenant: "{{variables.t}}" }, forEach: { items: "[1]", itemVariable: "case", indexVariable: "i" } } },
      { nodeId: "b", type: "workflow", config: { targetWorkflowId: "other", inputMapping: { unrelated: "x" } } },
      { nodeId: "c", type: "http-request", config: { targetWorkflowId: "child", inputMapping: { notACall: "x" } } },
    ]
    expect(callerSuppliedVariableNames(nodes, "child")).toEqual(["case", "i", "tenant"])
  })
})
