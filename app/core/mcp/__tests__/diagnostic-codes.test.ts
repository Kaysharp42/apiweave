import { describe, expect, it } from "vitest"
import { WORKFLOW_DIAGNOSTIC_CODES } from "@shared/analysis/workflow_graph_analyzer"
import { MCP_GUIDES } from "../guide"

/**
 * `apiweave://guide/diagnostics` promises "What every workflow_diagnose code
 * means and how to fix it". This pins the guide to the analyzer: every code the
 * analyzer can emit must have its row. The list is derived from
 * WORKFLOW_DIAGNOSTIC_CODES — the same const the analyzer types its emit sites
 * with — so a new code fails this test until its row is written, and no third
 * list exists to go stale. Codes are matched backtick-wrapped so
 * `assertion_source_missing` cannot pass on the substring inside
 * `assertion_source_missing_at_run`.
 */
describe("the diagnostics guide explains every code the analyzer can emit", () => {
  const guide = MCP_GUIDES.find((item) => item.slug === "diagnostics")?.text ?? ""

  it("has a row for every emitted code", () => {
    expect(guide).not.toBe("")
    const missing = WORKFLOW_DIAGNOSTIC_CODES.filter((code) => !guide.includes(`\`${code}\``))
    expect(missing).toEqual([])
  })
})
