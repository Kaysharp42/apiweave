import type { LoadNodeStats } from "@shared/types/LoadNodeStats"

/**
 * A CI gate on a load run's aggregate statistics, written as one expression:
 * `p95<500` (a node's 95th-percentile latency under 500 ms) or `errors<1%`
 * (a node's error rate under one percent). Evaluated against every node that
 * ran — a threshold is breached when any node violates it.
 *
 * Plain Node, no Electron: shared by the headless CLI and the desktop app.
 */

export type ThresholdMetric = "min" | "mean" | "p50" | "p90" | "p95" | "p99" | "max" | "errors" | "throughput"

export type ThresholdOperator = "<" | "<=" | ">" | ">=" | "=="

export interface Threshold {
  readonly metric: ThresholdMetric
  readonly operator: ThresholdOperator
  /** The right-hand side. For `errors` with `percent` this is a percentage, else an absolute count. */
  readonly value: number
  /** True when the expression ended in `%` (only meaningful for `errors`). */
  readonly percent: boolean
}

const EXPRESSION =
  /^\s*(min|mean|p50|p90|p95|p99|max|errors|throughput)\s*(<=|>=|==|<|>|=)\s*([0-9]+(?:\.[0-9]+)?)\s*(%?)\s*$/i

const OPERATOR: Readonly<Record<string, ThresholdOperator>> = {
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  "==": "==",
  "=": "==",
}

/**
 * Parse one `--threshold` expression. Throws an {@link Error} naming the
 * problem, so a bad flag is a usage error rather than a silently-ignored gate.
 */
export function parseThreshold(input: string): Threshold {
  const match = EXPRESSION.exec(input)
  if (match === null) {
    throw new Error(
      `invalid threshold '${input}': expected <metric><op><number>[%], e.g. p95<500 or errors<1% ` +
        `(metrics: min, mean, p50, p90, p95, p99, max, errors, throughput)`,
    )
  }
  const metric = match[1]!.toLowerCase() as ThresholdMetric
  const operator = OPERATOR[match[2]!]!
  const value = Number(match[3]!)
  const percent = match[4] === "%"
  if (percent && metric !== "errors") {
    throw new Error(`invalid threshold '${input}': '%' only applies to the 'errors' metric`)
  }
  return { metric, operator, value, percent }
}

/** The value a threshold compares, read from one node's aggregate stats. */
function metricValue(threshold: Threshold, node: LoadNodeStats): number | null {
  switch (threshold.metric) {
    case "min":
      return node.latency.minMs
    case "mean":
      return node.latency.meanMs
    case "p50":
      return node.latency.p50Ms
    case "p90":
      return node.latency.p90Ms
    case "p95":
      return node.latency.p95Ms
    case "p99":
      return node.latency.p99Ms
    case "max":
      return node.latency.maxMs
    case "errors":
      return threshold.percent ? node.errorRate * 100 : node.errorCount
    case "throughput":
      return node.throughput
  }
}

function satisfies(actual: number, threshold: Threshold): boolean {
  switch (threshold.operator) {
    case "<":
      return actual < threshold.value
    case "<=":
      return actual <= threshold.value
    case ">":
      return actual > threshold.value
    case ">=":
      return actual >= threshold.value
    case "==":
      return actual === threshold.value
  }
}

/**
 * Whether the threshold holds for this node. A node with no latency sample (it
 * never ran) always satisfies latency thresholds: there is nothing to gate.
 */
function nodeSatisfies(threshold: Threshold, node: LoadNodeStats): boolean {
  const value = metricValue(threshold, node)
  if (value === null) return true
  return satisfies(value, threshold)
}

export interface ThresholdBreach {
  readonly expression: string
  readonly nodeId: string
  readonly label: string
  readonly actual: number
  readonly expected: string
}

/**
 * Evaluate every threshold against every node. Returns the breaches, one per
 * node that violates a threshold. A non-empty result means the load run failed
 * its gate and CI should exit non-zero.
 */
export function evaluateThresholds(nodes: readonly LoadNodeStats[], thresholds: readonly Threshold[]): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = []
  for (const threshold of thresholds) {
    for (const node of nodes) {
      if (nodeSatisfies(threshold, node)) continue
      const actual = metricValue(threshold, node)
      breaches.push({
        expression: formatThreshold(threshold),
        nodeId: node.nodeId,
        label: node.label || node.nodeId,
        actual: actual ?? 0,
        expected: formatThreshold(threshold),
      })
    }
  }
  return breaches
}

/** A threshold written back in canonical form, e.g. `p95<500`, `errors<1%`. */
export function formatThreshold(threshold: Threshold): string {
  const unit = threshold.percent ? "%" : ""
  return `${threshold.metric}${threshold.operator}${threshold.value}${unit}`
}

/** A breach as one readable line for the console and reports. */
export function describeBreach(breach: ThresholdBreach): string {
  const unit = breach.expression.startsWith("errors")
    ? breach.expression.endsWith("%")
      ? "%"
      : ""
    : breach.expression.startsWith("throughput")
      ? "/s"
      : "ms"
  return `${breach.label}: ${breach.expression} (got ${breach.actual}${unit})`
}
