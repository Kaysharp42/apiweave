import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Workflow } from "@shared/types/Workflow"
import { mergeWorkflowNodePatches } from "../workflow_service"

const upserts = [
  { nodeId: "ok", type: "delay", position: { x: 0, y: 0 }, config: { duration: 2 } },
  { nodeId: "other", type: "delay", position: { x: 0, y: 0 }, config: { duration: 3 } },
  { nodeId: "login", type: "http-request", position: { x: 0, y: 0 }, config: { method: "FETCH", url: "/x" } },
]

describe("node validation in a graph patch", () => {
  it("prefixes issue paths with the input list, index and nodeId", () => {
    let thrown: unknown
    try {
      mergeWorkflowNodePatches([] as unknown as Workflow["nodes"], upserts as never, undefined)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ZodError)
    const issues = (thrown as ZodError).issues
    expect(issues.some((issue) => issue.path[0] === "upsertNodes" && issue.path[1] === 2 && issue.path.includes("method"))).toBe(true)
    expect(issues.every((issue) => issue.message.startsWith('nodeId "login": '))).toBe(true)
  })
})
