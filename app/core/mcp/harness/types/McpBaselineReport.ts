import type { McpCatalogueMeasurement } from "./McpCatalogueMeasurement"
import type { McpClientCapabilityRow } from "./McpClientCapabilityRow"
import type { McpFixturePayloadMeasurement } from "./McpFixturePayloadMeasurement"
import type { McpFixtureScenario } from "./McpFixtureScenario"
import type { McpTaskFixture } from "./McpTaskFixture"

/** Reproducible Phase 0 baseline output; agent-task observations are recorded separately. */
export interface McpBaselineReport {
  readonly formatVersion: 1
  readonly measurementDefinitions: Readonly<Record<string, string>>
  readonly catalogue: McpCatalogueMeasurement
  readonly fixturePayloads: readonly McpFixturePayloadMeasurement[]
  readonly fixtureScenarios: readonly McpFixtureScenario[]
  readonly tasks: readonly McpTaskFixture[]
  readonly clientCapabilities: readonly McpClientCapabilityRow[]
}
