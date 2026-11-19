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

  /**
   * The replace recipe: a merged patch cannot drop config keys (strict node
   * schemas reject the leftovers), so a locator-kind or action change names the
   * node in `removeNodeIds` and re-upserts its complete definition in the same
   * call. Removals apply before upserts, so the upsert is validated whole
   * against the node schema — never merged with the stored config.
   */
  it("remove+upsert of the same id replaces the node's config outright", () => {
    const nodes = mergeWorkflowNodePatches(
      [
        {
          nodeId: "email",
          type: "browser",
          position: { x: 0, y: 0 },
          config: { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value: "a@example.test" },
        },
      ],
      [
        {
          nodeId: "email",
          type: "browser",
          position: { x: 0, y: 0 },
          config: { action: "fill", locator: { kind: "label", value: "Email address" }, value: "a@example.test" },
        },
      ],
      ["email"],
    )

    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.config).toEqual({
      action: "fill",
      locator: { kind: "label", value: "Email address" },
      value: "a@example.test",
    })
  })
})
