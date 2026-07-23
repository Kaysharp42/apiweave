import fs from "node:fs"
import path from "node:path"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"

// -------------------- Types --------------------

export interface ArtifactFile {
  readonly name: string
  readonly path: string
  readonly sizeBytes: number
}

export interface ArtifactInfo {
  readonly runId: string
  readonly artifacts: readonly ArtifactFile[]
}

export interface ReporterOptions {
  /** nodeId → node type string (e.g. "http-request", "assertion") */
  readonly nodeTypes?: Readonly<Record<string, string>>
  /** nodeId → human-readable label */
  readonly nodeLabels?: Readonly<Record<string, string>>
}

// -------------------- Entity escaping --------------------

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// -------------------- XML builder (no DOM) --------------------

function xmlTag(
  name: string,
  attrs: Readonly<Record<string, string>>,
  content?: string,
): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("")
  if (content === undefined) {
    return `<${name}${attrStr} />`
  }
  return `<${name}${attrStr}>${content}</${name}>`
}

/** Convert ms to seconds string (3 decimal places). */
function sec(ms: number | undefined | null): string {
  if (ms == null || ms < 0) return "0.000"
  return (ms / 1000).toFixed(3)
}

/** Format ISO timestamp for human display. */
function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

/** Try to read RunResult status as a string from JsonValue. */
function nodeStatusValue(val: unknown): string {
  if (typeof val === "string") return val
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>
    if (typeof obj["status"] === "string") return obj["status"] as string
  }
  return "idle"
}

// -------------------- JUnit XML Reporter --------------------

/**
 * Generate JUnit XML from a completed Run.
 *
 * Maps each node in `Run.nodeStatuses` to a `<testcase>`. Node types are
 * read from `options.nodeTypes` if provided, otherwise classname defaults
 * to "node". Failure details come from `Run.results[n].error` / `Run.error`.
 */
export function generateJUnit(run: Readonly<Run>, options?: Readonly<ReporterOptions>): string {
  const nodeIds = Object.keys(run.nodeStatuses ?? {})
  const nodeTypes = options?.nodeTypes ?? {}
  const nodeLabels = options?.nodeLabels ?? {}

  // Index results by nodeId for quick lookup
  const resultsByNodeId = new Map<string, RunResult>()
  for (const r of run.results ?? []) {
    resultsByNodeId.set(r.nodeId, r)
  }

  // Count failures
  let failures = 0
  const testcases: string[] = []

  for (const nodeId of nodeIds) {
    const rawStatus = nodeStatusValue(run.nodeStatuses?.[nodeId])
    const result = resultsByNodeId.get(nodeId)
    const nodeType = nodeTypes[nodeId] ?? "node"
    const nodeLabel = nodeLabels[nodeId]
    const name = nodeLabel ?? nodeId

    // Duration in seconds
    const durationSec = sec(result?.duration)

    // Build testcase element
    const baseAttrs: Record<string, string> = {
      classname: nodeType,
      name,
      time: durationSec,
    }

    if (rawStatus === "failed") {
      failures++
      const errorRaw = result?.error ?? run.failureMessage ?? run.error ?? "Node failed"
      const failureType = nodeType === "assertion" ? "AssertionError" : "HttpError"
      // CDATA wraps raw content (no XML escaping inside CDATA blocks)
      const failureContent = `<![CDATA[${errorRaw}]]>`
      const failureXml = xmlTag("failure", { message: errorRaw, type: failureType }, failureContent)
      testcases.push(xmlTag("testcase", baseAttrs, failureXml))
    } else if (rawStatus === "skipped") {
      testcases.push(xmlTag("testcase", baseAttrs, xmlTag("skipped", {})))
    } else {
      testcases.push(xmlTag("testcase", baseAttrs))
    }
  }

  const totalTests = nodeIds.length
  const suiteAttrs: Record<string, string> = {
    name: run.workflowId ?? "workflow",
    tests: String(totalTests),
    failures: String(failures),
    errors: "0",
    time: sec(run.duration),
    timestamp: run.startedAt ?? run.createdAt ?? "",
  }

  const suiteXml = xmlTag("testsuite", suiteAttrs, testcases.join("\n  "))
  return `<?xml version="1.0" encoding="UTF-8"?>\n` + xmlTag("testsuites", {}, "\n  " + suiteXml + "\n")
}

// -------------------- HTML Reporter --------------------

/**
 * Generate a self-contained HTML report from a completed Run.
 * No external dependencies — template literal + inline CSS.
 */
export function generateHTML(run: Readonly<Run>, options?: Readonly<ReporterOptions>): string {
  const nodeIds = Object.keys(run.nodeStatuses ?? {})
  const nodeTypes = options?.nodeTypes ?? {}
  const nodeLabels = options?.nodeLabels ?? {}

  const resultsByNodeId = new Map<string, RunResult>()
  for (const r of run.results ?? []) {
    resultsByNodeId.set(r.nodeId, r)
  }

  // Compute pass/fail counts
  let passed = 0
  let failed = 0
  let skipped = 0

  for (const nodeId of nodeIds) {
    const rawStatus = nodeStatusValue(run.nodeStatuses?.[nodeId])
    if (rawStatus === "passed") passed++
    else if (rawStatus === "failed") failed++
    else if (rawStatus === "skipped") skipped++
  }

  const total = nodeIds.length
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0

  // Build node cards
  const nodeCards: string[] = []
  for (const nodeId of nodeIds) {
    const rawStatus = nodeStatusValue(run.nodeStatuses?.[nodeId])
    const result = resultsByNodeId.get(nodeId)
    const nodeType = nodeTypes[nodeId] ?? "node"
    const label = nodeLabels[nodeId]
    const displayName = label ?? nodeId

    let statusClass = "node-passed"
    if (rawStatus === "failed") statusClass = "node-failed"
    else if (rawStatus === "skipped") statusClass = "node-skipped"

    const durationStr = sec(result?.duration)

    // Build detail rows
    const detailRows: string[] = []

    // Type-specific details
    if (nodeType === "http-request" || nodeType === "http_request") {
      // Try to extract from result if available
      const req = result?.request
      const res = result?.response
      if (req && typeof req === "object") {
        const reqObj = req as Record<string, unknown>
        const method = reqObj["method"] ?? ""
        const url = reqObj["url"] ?? ""
        if (method || url) {
          detailRows.push(`<div class="metric"><span class="label">Request:</span> ${escapeHtml(String(method))} ${escapeHtml(String(url))}</div>`)
        }
      }
      if (res && typeof res === "object") {
        const resObj = res as Record<string, unknown>
        const statusCode = resObj["statusCode"] ?? resObj["status"]
        if (statusCode !== undefined) {
          detailRows.push(`<div class="metric"><span class="label">Status:</span> ${escapeHtml(String(statusCode))}</div>`)
        }
      }
    }

    if (nodeType === "assertion") {
      if (result?.assertions && Array.isArray(result.assertions)) {
        for (const a of result.assertions) {
          if (a && typeof a === "object") {
            const aObj = a as Record<string, unknown>
            detailRows.push(`<div class="metric">${escapeHtml(String(aObj["message"] ?? JSON.stringify(a)))}</div>`)
          }
        }
      } else if (result?.error) {
        detailRows.push(`<div class="metric error-text">${escapeHtml(result.error)}</div>`)
      }
    }

    // Error details
    const errorText = result?.error ?? (rawStatus === "failed" ? run.failureMessage ?? run.error : null)
    if (errorText && nodeType !== "assertion") {
      detailRows.push(`<div class="metric error-text">${escapeHtml(errorText)}</div>`)
    }

    // Expandable details section for request/response bodies
    let detailsSection = ""
    if (result?.request || result?.response) {
      const reqPreview = result?.request
        ? `<pre class="detail-json">${escapeHtml(JSON.stringify(result.request, null, 2))}</pre>`
        : ""
      const resPreview = result?.response
        ? `<pre class="detail-json">${escapeHtml(JSON.stringify(result.response, null, 2))}</pre>`
        : ""
      detailsSection = `
        <details class="node-details">
          <summary>Details</summary>
          ${reqPreview ? `<div class="detail-section"><h4>Request</h4>${reqPreview}</div>` : ""}
          ${resPreview ? `<div class="detail-section"><h4>Response</h4>${resPreview}</div>` : ""}
        </details>`
    }

    const cardHtml = `
      <div class="node-card ${statusClass}">
        <div class="node-header">
          <span class="node-id">${escapeHtml(displayName)}</span>
          <span class="node-type-badge">${escapeHtml(nodeType)}</span>
          <span class="status-badge status-${escapeHtml(rawStatus)}">${escapeHtml(rawStatus)}</span>
          <span class="node-duration">${durationStr}s</span>
        </div>
        ${detailRows.length > 0 ? `<div class="node-body">${detailRows.join("\n          ")}</div>` : ""}
        ${detailsSection}
      </div>`

    nodeCards.push(cardHtml)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>APIWeave Run Report — ${escapeHtml(run.runId)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f5f5f7; color: #1d1d1f; padding: 24px; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 4px; }
  .meta { color: #6e6e73; font-size: 0.875rem; margin-bottom: 20px; }
  .meta dt { display: inline; font-weight: 500; }
  .meta dd { display: inline; margin-right: 16px; }
  .summary-bar { display: flex; gap: 16px; padding: 16px; background: #fff; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .summary-item { text-align: center; flex: 1; }
  .summary-item .count { font-size: 1.75rem; font-weight: 700; line-height: 1.2; }
  .summary-item .label { font-size: 0.75rem; color: #6e6e73; text-transform: uppercase; letter-spacing: 0.05em; }
  .count-pass { color: #30d158; }
  .count-fail { color: #ff453a; }
  .count-skip { color: #ff9f0a; }
  .count-rate { color: #007aff; }
  .node-card { background: #fff; border-radius: 10px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: hidden; }
  .node-card.node-failed { border-left: 4px solid #ff453a; }
  .node-card.node-passed { border-left: 4px solid #30d158; }
  .node-card.node-skipped { border-left: 4px solid #ff9f0a; }
  .node-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
  .node-id { font-weight: 500; flex: 1; }
  .node-type-badge { font-size: 0.75rem; background: #e8e8ed; color: #6e6e73; padding: 2px 8px; border-radius: 4px; }
  .status-badge { font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
  .status-passed { background: #d1fae5; color: #065f46; }
  .status-failed { background: #fee2e2; color: #991b1b; }
  .status-skipped { background: #fef3c7; color: #92400e; }
  .node-duration { font-size: 0.8125rem; color: #6e6e73; font-variant-numeric: tabular-nums; }
  .node-body { padding: 0 16px 12px; }
  .metric { font-size: 0.8125rem; color: #3a3a3c; margin-bottom: 4px; }
  .metric .label { color: #6e6e73; }
  .error-text { color: #ff453a; }
  .node-details { margin: 0 16px 12px; border-top: 1px solid #e8e8ed; padding-top: 8px; }
  .node-details summary { cursor: pointer; font-size: 0.8125rem; color: #007aff; font-weight: 500; }
  .detail-section { margin-top: 8px; }
  .detail-section h4 { font-size: 0.75rem; color: #6e6e73; margin-bottom: 4px; }
  .detail-json { background: #f5f5f7; padding: 8px; border-radius: 6px; font-size: 0.75rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  .node-vars { padding: 0 16px 12px; }
  .node-vars h4 { font-size: 0.75rem; color: #6e6e73; margin-bottom: 4px; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1c1e; color: #f5f5f7; }
    .summary-bar, .node-card { background: #2c2c2e; }
    .node-type-badge { background: #3a3a3c; color: #a1a1a6; }
    .status-passed { background: #1a3a2a; color: #30d158; }
    .status-failed { background: #3a1a1a; color: #ff453a; }
    .status-skipped { background: #3a2a1a; color: #ff9f0a; }
    .metric { color: #c7c7cc; }
    .detail-json { background: #1c1c1e; }
    .node-details { border-top-color: #3a3a3c; }
    .meta { color: #8e8e93; }
  }
</style>
</head>
<body>
  <h1>Workflow Run Report</h1>
  <dl class="meta">
    <dt>Status:</dt><dd>${escapeHtml(run.status)}</dd>
    <dt>Run ID:</dt><dd>${escapeHtml(run.runId)}</dd>
    <dt>Workflow:</dt><dd>${escapeHtml(run.workflowId)}</dd>
    <dt>Started:</dt><dd>${escapeHtml(formatTimestamp(run.startedAt))}</dd>
    <dt>Duration:</dt><dd>${sec(run.duration)}s</dd>
  </dl>

  <div class="summary-bar">
    <div class="summary-item"><div class="count count-pass">${passed}</div><div class="label">Passed</div></div>
    <div class="summary-item"><div class="count count-fail">${failed}</div><div class="label">Failed</div></div>
    <div class="summary-item"><div class="count count-skip">${skipped}</div><div class="label">Skipped</div></div>
    <div class="summary-item"><div class="count count-rate">${passRate}%</div><div class="label">Pass Rate</div></div>
  </div>

  <div class="node-list">
${nodeCards.join("\n")}
  </div>
</body>
</html>`
}

// -------------------- Artifact storage --------------------

const ARTIFACTS_DIR_NAME = "apiweave"
const ARTIFACTS_SUBDIR = "runs"

/** Resolve the artifacts directory for a given run. */
export function artifactsDir(baseDir: string, runId: string): string {
  return path.join(baseDir, ARTIFACTS_DIR_NAME, ARTIFACTS_SUBDIR, runId)
}

/**
 * Resolve an artifact file path, guaranteeing it stays under the runs root.
 * `runId` is caller-controlled (IPC input), so guard against path traversal
 * (e.g. `runId = "../.."`). `artifactName` should already be enum-restricted.
 */
export function resolveArtifactPath(baseDir: string, runId: string, artifactName: string): string {
  const runsRoot = path.resolve(baseDir, ARTIFACTS_DIR_NAME, ARTIFACTS_SUBDIR)
  const resolved = path.resolve(artifactsDir(baseDir, runId), artifactName)
  if (resolved !== runsRoot && !resolved.startsWith(runsRoot + path.sep)) {
    throw new Error("Artifact path escapes runs directory")
  }
  return resolved
}

const ARTIFACT_FILES = [
  { name: "junit.xml", contentFn: generateJUnit },
  { name: "report.html", contentFn: generateHTML },
] as const

/**
 * Write JUnit and HTML artifacts to disk. Returns metadata about what was
 * written (paths + sizes). `baseDir` is typically `app.getPath("temp")`
 * resolved by the IPC caller.
 */
export async function writeReportArtifacts(
  runId: string,
  baseDir: string,
  run: Readonly<Run>,
  options?: Readonly<ReporterOptions>,
): Promise<ArtifactInfo> {
  const dir = artifactsDir(baseDir, runId)
  await fs.promises.mkdir(dir, { recursive: true })

  const artifacts: ArtifactFile[] = []

  for (const file of ARTIFACT_FILES) {
    const content = file.contentFn(run, options)
    const filePath = path.join(dir, file.name)
    await fs.promises.writeFile(filePath, content, "utf-8")
    const stat = await fs.promises.stat(filePath)
    artifacts.push({ name: file.name, path: filePath, sizeBytes: stat.size })
  }

  return { runId, artifacts }
}

/**
 * Read artifact metadata for a run from disk. Returns `null` if the
 * artifacts directory does not exist.
 */
export async function readReportArtifacts(
  runId: string,
  baseDir: string,
): Promise<ArtifactInfo | null> {
  const dir = artifactsDir(baseDir, runId)
  try {
    await fs.promises.access(dir)
  } catch {
    return null
  }

  const artifacts: ArtifactFile[] = []
  for (const file of ARTIFACT_FILES) {
    const filePath = path.join(dir, file.name)
    try {
      const stat = await fs.promises.stat(filePath)
      artifacts.push({ name: file.name, path: filePath, sizeBytes: stat.size })
    } catch {
      // File might not exist if generation was partial
      continue
    }
  }

  return { runId, artifacts }
}
