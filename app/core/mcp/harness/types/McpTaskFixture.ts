/** A representative task and its outcome-based success condition. */
export interface McpTaskFixture {
  readonly id: string
  readonly prompt: string
  readonly fixtureIds: readonly string[]
  readonly successCriteria: string
}
