import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generateJUnit, generateHTML, writeReportArtifacts, readReportArtifacts } from "../reporters"
import type { Run } from "@shared/types/Run"

// -------------------- Fixtures --------------------

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: "run_test_001",
    workspaceId: "ws_test",
    workflowId: "wf_test",
    status: "completed",
    trigger: "manual",
    variables: {},
    results: [],
    startedAt: "2026-07-06T10:00:00.000Z",
    completedAt: "2026-07-06T10:00:05.000Z",
    duration: 5000,
    error: null,
    failedNodes: null,
    failureMessage: null,
    nodeStatuses: {
      start_1: "passed",
      http_1: "passed",
      assertion_1: "passed",
      end_1: "passed",
    },
    rev: 1,
    createdAt: "2026-07-06T10:00:00.000Z",
    updatedAt: "2026-07-06T10:00:05.000Z",
    selectedEnvironmentId: null,
    resumeFromRunId: null,
    resumeFromNodeIds: null,
    resumeMode: null,
    ...overrides,
  }
}

const NODE_TYPES: Record<string, string> = {
  start_1: "start",
  http_1: "http-request",
  assertion_1: "assertion",
  end_1: "end",
}

const NODE_LABELS: Record<string, string> = {
  http_1: "GET /api/users",
  assertion_1: "Check status 200",
}

// -------------------- JUnit XML --------------------

describe("generateJUnit", () => {
  it("produces valid JUnit XML with expected elements", () => {
    const xml = generateJUnit(makeRun(), { nodeTypes: NODE_TYPES, nodeLabels: NODE_LABELS })

    // XML declaration
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    // Root element
    expect(xml).toContain("<testsuites>")
    expect(xml).toContain("</testsuites>")
    // Testsuite
    expect(xml).toContain('<testsuite name="wf_test"')
    expect(xml).toContain('tests="4"')
    expect(xml).toContain('failures="0"')
    expect(xml).toContain('errors="0"')

    // Testcases present
    expect(xml).toContain('classname="http-request"')
    expect(xml).toContain('name="GET /api/users"')
    expect(xml).toContain('classname="assertion"')
    expect(xml).toContain('name="Check status 200"')
    expect(xml).toContain('classname="start"')
    expect(xml).toContain('classname="end"')

    // No failure elements for all-passing run
    expect(xml).not.toContain("<failure")
    expect(xml).not.toContain("<skipped")
  })

  it("includes failure elements for failed nodes", () => {
    const run = makeRun({
      status: "failed",
      nodeStatuses: {
        http_1: "failed",
        assertion_1: "passed",
      },
      failedNodes: ["http_1"],
      failureMessage: "Connection refused",
      results: [
        {
          nodeId: "http_1",
          status: "failed",
          duration: 1500,
          error: "ECONNREFUSED",
          request: null,
          response: null,
          assertions: null,
        },
      ],
    })

    const xml = generateJUnit(run, { nodeTypes: { http_1: "http-request", assertion_1: "assertion" } })

    expect(xml).toContain('failures="1"')
    expect(xml).toContain("<failure")
    expect(xml).toContain('type="HttpError"')
    expect(xml).toContain("ECONNREFUSED")
  })

  it("uses AssertionError type for assertion failures", () => {
    const run = makeRun({
      status: "failed",
      nodeStatuses: { assert_1: "failed" },
      failedNodes: ["assert_1"],
      results: [
        {
          nodeId: "assert_1",
          status: "failed",
          duration: 100,
          error: "Expected 200, got 500",
          request: null,
          response: null,
          assertions: null,
        },
      ],
    })

    const xml = generateJUnit(run, { nodeTypes: { assert_1: "assertion" } })
    expect(xml).toContain('type="AssertionError"')
    expect(xml).toContain("Expected 200, got 500")
  })

  it("marks skipped nodes", () => {
    const run = makeRun({
      nodeStatuses: { node_1: "skipped" },
      results: [],
    })

    const xml = generateJUnit(run, { nodeTypes: { node_1: "delay" } })
    expect(xml).toContain("<skipped />")
  })

  it("escapes XML entities in user-provided strings", () => {
    const run = makeRun({
      workflowId: 'wf<test&co>',
      nodeStatuses: { node_1: "failed" },
      failureMessage: 'error with <tag> & "quotes"',
      results: [
        {
          nodeId: "node_1",
          status: "failed",
          duration: 0,
          error: 'error with <tag> & "quotes"',
          request: null,
          response: null,
          assertions: null,
        },
      ],
    })

    const xml = generateJUnit(run, { nodeTypes: { node_1: "http-request" } })

    // Workflow ID in attribute — single-escaped by xmlTag
    expect(xml).toContain('name="wf&lt;test&amp;co&gt;"')

    // Failure message attribute — single-escaped by xmlTag
    expect(xml).toContain('message="error with &lt;tag&gt; &amp; &quot;quotes&quot;"')

    // CDATA content is RAW (no escaping inside CDATA blocks)
    expect(xml).toContain("<![CDATA[error with <tag> & \"quotes\"]]>")

    // Raw angle brackets and ampersands should NOT appear outside CDATA
    const outsideCdata = xml.replace(/<!\[CDATA\[.*?\]\]>/g, "")
    expect(outsideCdata).not.toContain("<tag>")
    expect(outsideCdata).not.toContain('"quotes"')
  })

  it("does not leak secrets into JUnit output", () => {
    const secretNames = ["api_key", "secret_key", "password", "access_token", "private_key"]
    const run = makeRun({
      nodeStatuses: { node_1: "failed" },
      failureMessage: "Some error",
      variables: { api_key: "sk-abc123", password: "super-secret!" },
    })

    const xml = generateJUnit(run, { nodeTypes: { node_1: "http-request" } })

    for (const secret of secretNames) {
      expect(xml).not.toContain(secret)
    }
    expect(xml).not.toContain("sk-abc123")
    expect(xml).not.toContain("super-secret!")
  })

  it("defaults classname to 'node' when nodeTypes not provided", () => {
    const run = makeRun({ nodeStatuses: { n1: "passed" } })
    const xml = generateJUnit(run)
    expect(xml).toContain('classname="node"')
  })
})

// -------------------- HTML report --------------------

describe("generateHTML", () => {
  it("includes summary bar with pass/fail counts", () => {
    const html = generateHTML(makeRun(), { nodeTypes: NODE_TYPES })
    expect(html).toContain("summary-bar")
    expect(html).toContain("Passed")
    expect(html).toContain("Failed")
    expect(html).toContain("Pass Rate")
    expect(html).toContain("100%")
  })

  it("renders node cards with status CSS classes", () => {
    const run = makeRun({
      nodeStatuses: {
        pass_node: "passed",
        fail_node: "failed",
        skip_node: "skipped",
      },
    })

    const html = generateHTML(run, {
      nodeTypes: { pass_node: "http-request", fail_node: "assertion", skip_node: "delay" },
    })

    // Status class present for each variant
    expect(html).toContain('class="node-card node-passed"')
    expect(html).toContain('class="node-card node-failed"')
    expect(html).toContain('class="node-card node-skipped"')

    // Status badges
    expect(html).toContain("status-passed")
    expect(html).toContain("status-failed")
    expect(html).toContain("status-skipped")
  })

  it("shows metadata header with run info", () => {
    const html = generateHTML(makeRun())
    expect(html).toContain("Workflow Run Report")
    expect(html).toContain("run_test_001")
    expect(html).toContain("wf_test")
    expect(html).toContain("completed")
  })

  it("escapes HTML entities in user strings", () => {
    const run = makeRun({
      workflowId: '"><script>alert(1)</script>',
      nodeStatuses: { n1: "failed" },
      failureMessage: '<script>steal()</script>',
    })

    const html = generateHTML(run)

    // Script tags must be escaped
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("includes node type badges", () => {
    const html = generateHTML(makeRun(), { nodeTypes: NODE_TYPES })
    expect(html).toContain("http-request")
    expect(html).toContain("assertion")
    expect(html).toContain("start")
    expect(html).toContain("end")
  })

  it("includes node labels if provided", () => {
    const html = generateHTML(makeRun(), {
      nodeTypes: NODE_TYPES,
      nodeLabels: NODE_LABELS,
    })
    expect(html).toContain("GET /api/users")
    expect(html).toContain("Check status 200")
  })

  it("shows error text for failed nodes", () => {
    const run = makeRun({
      status: "failed",
      nodeStatuses: { n1: "failed" },
      failureMessage: "Connection timeout",
      results: [
        {
          nodeId: "n1",
          status: "failed",
          duration: 30000,
          error: "Socket hang up",
          request: null,
          response: null,
          assertions: null,
        },
      ],
    })

    const html = generateHTML(run, { nodeTypes: { n1: "http-request" } })
    expect(html).toContain("error-text")
    expect(html).toContain("Socket hang up")
  })

  it("does not leak secrets into HTML output", () => {
    const run = makeRun({
      nodeStatuses: { n1: "failed" },
      failureMessage: "Some error",
      variables: { api_key: "sk-abc123", password: "super-secret!" },
    })

    const html = generateHTML(run)
    expect(html).not.toContain("sk-abc123")
    expect(html).not.toContain("super-secret!")
  })

  it("includes dark mode media query in CSS", () => {
    const html = generateHTML(makeRun())
    expect(html).toContain("prefers-color-scheme: dark")
  })
})

// -------------------- Artifact storage --------------------

describe("writeReportArtifacts / readReportArtifacts", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-test-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("writes junit.xml and report.html to correct path", async () => {
    const run = makeRun()
    const info = await writeReportArtifacts(run.runId, tmpDir, run, { nodeTypes: NODE_TYPES })

    expect(info.runId).toBe("run_test_001")
    expect(info.artifacts).toHaveLength(2)

    const junitArtifact = info.artifacts.find((a) => a.name === "junit.xml")
    const htmlArtifact = info.artifacts.find((a) => a.name === "report.html")

    expect(junitArtifact).toBeDefined()
    expect(htmlArtifact).toBeDefined()
    expect(junitArtifact!.sizeBytes).toBeGreaterThan(0)
    expect(htmlArtifact!.sizeBytes).toBeGreaterThan(0)

    // Verify files exist
    expect(fs.existsSync(junitArtifact!.path)).toBe(true)
    expect(fs.existsSync(htmlArtifact!.path)).toBe(true)

    // Path should be under tmpDir/apiweave/runs/{runId}/
    expect(junitArtifact!.path).toContain(path.join("apiweave", "runs", "run_test_001"))
    expect(htmlArtifact!.path).toContain(path.join("apiweave", "runs", "run_test_001"))
  })

  it("reads back artifact metadata with readReportArtifacts", async () => {
    const run = makeRun()
    await writeReportArtifacts(run.runId, tmpDir, run, { nodeTypes: NODE_TYPES })

    const info = await readReportArtifacts(run.runId, tmpDir)
    expect(info).not.toBeNull()
    expect(info!.runId).toBe("run_test_001")
    expect(info!.artifacts).toHaveLength(2)

    // Sizes should be non-zero
    for (const a of info!.artifacts) {
      expect(a.sizeBytes).toBeGreaterThan(0)
    }
  })

  it("returns null from readReportArtifacts when dir missing", async () => {
    const info = await readReportArtifacts("nonexistent", tmpDir)
    expect(info).toBeNull()
  })

  it("written files contain correct XML and HTML content", async () => {
    const run = makeRun()
    await writeReportArtifacts(run.runId, tmpDir, run, { nodeTypes: NODE_TYPES })

    const junitPath = path.join(tmpDir, "apiweave", "runs", run.runId, "junit.xml")
    const htmlPath = path.join(tmpDir, "apiweave", "runs", run.runId, "report.html")

    const junitContent = fs.readFileSync(junitPath, "utf-8")
    const htmlContent = fs.readFileSync(htmlPath, "utf-8")

    expect(junitContent).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(junitContent).toContain("<testsuites>")
    expect(htmlContent).toContain("<!DOCTYPE html>")
    expect(htmlContent).toContain("summary-bar")
  })

  it("does not write secrets to artifact files", async () => {
    const secretNames = ["sk-abc123", "super-secret!", "my_api_key_12345"]
    const run = makeRun({
      nodeStatuses: { n1: "failed" },
      failureMessage: "Some error",
      variables: { api_key: "sk-abc123", password: "super-secret!", custom: "my_api_key_12345" },
    })

    await writeReportArtifacts(run.runId, tmpDir, run, { nodeTypes: { n1: "http-request" } })

    const junitContent = fs.readFileSync(path.join(tmpDir, "apiweave", "runs", run.runId, "junit.xml"), "utf-8")
    const htmlContent = fs.readFileSync(path.join(tmpDir, "apiweave", "runs", run.runId, "report.html"), "utf-8")

    for (const secret of secretNames) {
      expect(junitContent).not.toContain(secret)
      expect(htmlContent).not.toContain(secret)
    }
  })
})
