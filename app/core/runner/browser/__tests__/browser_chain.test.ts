import { describe, expect, it } from "vitest"
import { withBrowserChainStart } from "../../resume"
import type { WorkflowEdge, WorkflowNode } from "../../executor"

const node = (nodeId: string, type: WorkflowNode["type"]): WorkflowNode => ({ nodeId, type })
const edge = (source: string, target: string): WorkflowEdge => ({ edgeId: `${source}-${target}`, source, target })
const isBrowser = (candidate: WorkflowNode): boolean => candidate.type === "browser" || candidate.nodeId === "login-call"

// start → api → open → fill → check → report
//                              └→ audit
const nodes = [
  node("start", "start"),
  node("api", "http-request"),
  node("open", "browser"),
  node("fill", "browser"),
  node("check", "browser"),
  node("report", "http-request"),
  node("audit", "http-request"),
]
const edges = [edge("start", "api"), edge("api", "open"), edge("open", "fill"), edge("fill", "check"), edge("check", "report"), edge("fill", "audit")]

describe("withBrowserChainStart", () => {
  it("adds the first browser step when the rerun would run a later one", () => {
    expect(withBrowserChainStart(nodes, edges, ["check"], isBrowser)).toEqual(["check", "open"])
  })

  it("leaves a rerun that reaches no browser step alone", () => {
    expect(withBrowserChainStart(nodes, edges, ["report"], isBrowser)).toEqual(["report"])
    expect(withBrowserChainStart(nodes, edges, ["audit"], isBrowser)).toEqual(["audit"])
  })

  it("leaves a rerun that already starts the chain alone", () => {
    expect(withBrowserChainStart(nodes, edges, ["open"], isBrowser)).toEqual(["open"])
    expect(withBrowserChainStart(nodes, edges, ["api"], isBrowser)).toEqual(["api"])
  })

  it("counts a call into a workflow with browser steps as the chain's start", () => {
    const withCall = [node("start", "start"), node("login-call", "workflow"), node("check", "browser")]
    const callEdges = [edge("start", "login-call"), edge("login-call", "check")]
    expect(withBrowserChainStart(withCall, callEdges, ["check"], isBrowser)).toEqual(["check", "login-call"])
  })
})
