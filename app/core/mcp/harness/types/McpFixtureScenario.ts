/** A deterministic data condition the baseline runner must make available to task trials. */
export interface McpFixtureScenario {
  readonly id: string
  readonly description: string
  readonly workflowCount: number
  readonly nodeCount: number | null
  readonly runCount: number | null
  readonly conditions: readonly string[]
}
