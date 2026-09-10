import {
  requestWireJsonBytes,
  responseWireJsonBytes,
  structuredContentBytes,
  textContentBytes,
} from "./measurements"
import type {
  McpBenchmarkCall,
  McpBenchmarkCounters,
  McpBenchmarkObservation,
  McpBenchmarkTaskReport,
  McpModelVisibleTokens,
} from "./types"

/**
 * Records one agent task without retaining payload values. Token metrics are
 * deliberately nullable until a client/provider trace supplies them.
 */
export class McpBenchmarkRecorder {
  private readonly calls: McpBenchmarkCall[] = []
  private counters: McpBenchmarkCounters = {
    modelTurns: 0,
    toolInvocations: 0,
    resourceReads: 0,
    polls: 0,
    errors: 0,
    retries: 0,
  }
  private modelVisibleTokens: McpModelVisibleTokens | null = null
  private taskSuccess: boolean | null = null
  private taskOutcome: string | null = null

  constructor(private readonly taskId: string) {}

  recordModelTurn(tokens?: McpModelVisibleTokens): void {
    this.counters = { ...this.counters, modelTurns: this.counters.modelTurns + 1 }
    if (tokens !== undefined) this.modelVisibleTokens = addTokens(this.modelVisibleTokens, tokens)
  }

  recordResourceRead(): void {
    this.counters = { ...this.counters, resourceReads: this.counters.resourceReads + 1 }
  }

  recordToolInvocation(observation: McpBenchmarkObservation): void {
    const modelVisibleTokens = observation.modelVisibleTokens ?? null
    this.calls.push({
      toolName: observation.toolName,
      requestWireJsonBytes: requestWireJsonBytes(observation.toolName, observation.arguments),
      responseWireJsonBytes: responseWireJsonBytes(observation.result),
      responseTextBytes: textContentBytes(observation.result),
      responseStructuredBytes: structuredContentBytes(observation.result),
      durationMs: observation.durationMs,
      status: observation.status,
      modelVisibleTokens,
    })
    this.counters = {
      ...this.counters,
      toolInvocations: this.counters.toolInvocations + 1,
      polls: this.counters.polls + (observation.poll === true ? 1 : 0),
      errors: this.counters.errors + (observation.status === "error" ? 1 : 0),
      retries: this.counters.retries + (observation.retry === true ? 1 : 0),
    }
    if (modelVisibleTokens !== null) this.modelVisibleTokens = addTokens(this.modelVisibleTokens, modelVisibleTokens)
  }

  recordTaskOutcome(success: boolean, outcome: string): void {
    this.taskSuccess = success
    this.taskOutcome = outcome
  }

  report(): McpBenchmarkTaskReport {
    return {
      taskId: this.taskId,
      counters: this.counters,
      calls: this.calls,
      modelVisibleTokens: this.modelVisibleTokens,
      taskSuccess: this.taskSuccess,
      taskOutcome: this.taskOutcome,
    }
  }
}

function addTokens(current: McpModelVisibleTokens | null, next: McpModelVisibleTokens): McpModelVisibleTokens {
  if (current === null) return next
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    cached: current.cached === null || next.cached === null ? null : current.cached + next.cached,
  }
}
