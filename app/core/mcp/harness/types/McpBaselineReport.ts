import type { McpCatalogueMeasurement } from "./McpCatalogueMeasurement"
import type { McpClientCapabilityRow } from "./McpClientCapabilityRow"
import type { McpFixturePayloadMeasurement } from "./McpFixturePayloadMeasurement"
import type { McpFixtureScenario } from "./McpFixtureScenario"
import type { McpScriptedTaskResult } from "./McpScriptedTaskResult"
import type { McpTaskFixture } from "./McpTaskFixture"

/** Reproducible Phase 0 baseline output, including scripted task observations. */
export interface McpBaselineReport {
  readonly formatVersion: 1
  readonly measurementDefinitions: Readonly<Record<string, string>>
  readonly catalogue: McpCatalogueMeasurement
  readonly fixturePayloads: readonly McpFixturePayloadMeasurement[]
  readonly fixtureScenarios: readonly McpFixtureScenario[]
  readonly tasks: readonly McpTaskFixture[]
  /** Scripted tasks measured through a real MCP client against a seeded database. */
  readonly scriptedTasks: readonly McpScriptedTaskResult[]
  readonly clientCapabilities: readonly McpClientCapabilityRow[]
}
