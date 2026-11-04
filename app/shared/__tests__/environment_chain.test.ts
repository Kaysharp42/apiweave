import { describe, expect, it } from "vitest"
import { MAX_BASE_ENVIRONMENT_CHAIN_DEPTH, baseEnvironmentProblem } from "../environments/environment_chain"

const link = (environmentId: string, baseEnvironmentId: string | null) => ({ environmentId, baseEnvironmentId })

describe("baseEnvironmentProblem", () => {
  it("accepts a root, a chain and several roots", () => {
    expect(baseEnvironmentProblem([link("a", null), link("b", "a"), link("c", "b"), link("d", null)])).toBeUndefined()
  })

  it("accepts a chain of exactly the maximum depth and refuses one environment more", () => {
    const chain = Array.from({ length: MAX_BASE_ENVIRONMENT_CHAIN_DEPTH }, (_, index) => link(`env-${index}`, index === 0 ? null : `env-${index - 1}`))
    expect(baseEnvironmentProblem(chain)).toBeUndefined()

    expect(baseEnvironmentProblem([...chain, link("env-too-deep", `env-${MAX_BASE_ENVIRONMENT_CHAIN_DEPTH - 1}`)])).toMatch(/deeper than 8 environments/)
  })

  it("refuses a base that is not in the same list, a self-reference and a cycle", () => {
    expect(baseEnvironmentProblem([link("a", "elsewhere")])).toMatch(/extends elsewhere, which is not in this workspace/)
    expect(baseEnvironmentProblem([link("a", "a")])).toMatch(/extends itself through a/)
    expect(baseEnvironmentProblem([link("a", "b"), link("b", "a")])).toMatch(/base environment chain would create a cycle/)
  })
})
