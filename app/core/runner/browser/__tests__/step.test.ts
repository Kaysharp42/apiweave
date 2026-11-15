import { describe, expect, it } from "vitest"
import { unresolvedPlaceholderFailure } from "../step"

describe("unresolvedPlaceholderFailure", () => {
  it("passes a value with no placeholder left in it", () => {
    expect(unresolvedPlaceholderFailure("ada@example.com", "{{variables.email}}")).toBeUndefined()
  })

  it("names a placeholder the step's own text still carries", () => {
    expect(unresolvedPlaceholderFailure("{{env.TEST_EMAIL}}", "{{env.TEST_EMAIL}}")).toBe("{{env.TEST_EMAIL}} is not set")
  })

  it("names a direct node reference or unknown function call left in place", () => {
    expect(unresolvedPlaceholderFailure("id-{{order.response.body.id}}", "id-{{order.response.body.id}}")).toBe(
      "{{order.response.body.id}} is not set",
    )
    expect(unresolvedPlaceholderFailure("{{now()}}", "{{now()}}")).toBe("{{now()}} is not set")
  })

  it("keeps a placeholder that came from a resolved value out of the error", () => {
    expect(unresolvedPlaceholderFailure("key-{{leaked}}", "{{secrets.API_KEY}}")).toBe("a placeholder could not be resolved")
  })

  it("names the first placeholder when the step carries several", () => {
    expect(unresolvedPlaceholderFailure("{{env.A}}/{{env.B}}", "{{env.A}}/{{env.B}}")).toBe("{{env.A}} is not set")
  })
})
