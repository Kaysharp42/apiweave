import { describe, expect, it } from "vitest"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import { diagnose, timeoutReason, unresolvedPlaceholderFailure } from "../step"

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

/** A Playwright timeout with its call log, as `runBrowserStep` receives it. */
class PlaywrightTimeout extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "TimeoutError"
  }
}

describe("timeoutReason", () => {
  it("says not found only when the call log never got past waiting", () => {
    expect(
      timeoutReason(["locator.fill: Timeout 10000ms exceeded.", "Call log:", "  - waiting for getByLabel('Email')"].join("\n")),
    ).toBe("it was not found (if an earlier step saw it, it may have closed or moved since)")
  })

  it("stays neutral when the locator resolved but never became actionable", () => {
    expect(
      timeoutReason(
        [
          "locator.click: Timeout 10000ms exceeded.",
          "Call log:",
          "  - waiting for getByRole('button', { name: 'Sign in' })",
          "    - locator resolved to <button …>Sign in</button>",
          "    - attempting click action",
        ].join("\n"),
      ),
    ).toBe("it did not become ready in time (see detail)")
  })

  it("stays neutral for a message with no call log to read", () => {
    expect(timeoutReason("Timeout 10000ms exceeded.")).toBe("it did not become ready in time (see detail)")
  })

  it("keeps mapping the actionable states Playwright names", () => {
    expect(timeoutReason('  <div class="overlay" …> intercepts pointer events')).toBe(
      "another element covers it (if this is a visually hidden input, click its label or press Space)",
    )
    expect(timeoutReason("  element is not visible")).toBe("it is not visible")
    expect(timeoutReason("  element is not enabled")).toBe("it is disabled")
    expect(timeoutReason("  element is not editable")).toBe("it is not editable")
    expect(timeoutReason("  element is outside of the viewport")).toBe("it is outside the page")
    expect(timeoutReason("  element is not stable")).toBe("it kept moving")
  })
})

describe("diagnose", () => {
  const fill: BrowserNodeData = { action: "fill", locator: { kind: "label", value: "Email" }, value: "{{variables.email}}" }
  const click: BrowserNodeData = { action: "click", locator: { kind: "role", role: "button", name: "Sign in" } }

  it("names the step, the timeout and the honest reason", () => {
    const error = new PlaywrightTimeout(
      ["locator.fill: Timeout 10000ms exceeded.", "Call log:", "  - waiting for getByLabel('Email')"].join("\n"),
    )
    expect(diagnose(error, fill, 10_000)).toBe("fill on getByLabel('Email') timed out after 10s: it was not found (if an earlier step saw it, it may have closed or moved since)")
  })

  it("points at the stored detail when the element existed but never became ready", () => {
    const error = new PlaywrightTimeout(
      [
        "locator.click: Timeout 30000ms exceeded.",
        "Call log:",
        "  - waiting for getByRole('button', { name: 'Sign in' })",
        "    - locator resolved to <button …>Sign in</button>",
        "    - attempting click action",
      ].join("\n"),
    )
    expect(diagnose(error, click, 30_000)).toBe(
      "click on getByRole('button', { name: 'Sign in' }) timed out after 30s: it did not become ready in time (see detail)",
    )
  })

  it("lifts the candidates of an ambiguous locator into the error, capped", () => {
    const lines = Array.from({ length: 7 }, (_unused, index) => `    ${index + 1}) <button>…</button> aka getByRole('button', { name: 'Item ${index + 1}' })`)
    const error = new Error(["locator.click: Error: strict mode violation: getByRole('button') resolved to 7 elements:", ...lines].join("\n"))
    const message = diagnose(error, click, 10_000)
    expect(message).toContain("matches 7 elements (getByRole('button', { name: 'Item 1' });")
    expect(message).toContain("Item 5' }); 2 more)")
    expect(message).not.toContain("Item 6")
    expect(message).not.toContain("<button")
  })

  it("omits a candidate too long to show instead of truncating it, and counts it in the remainder", () => {
    const longName = `getByRole('button', { name: '${"x".repeat(90)}' })`
    const error = new Error([
      "locator.click: Error: strict mode violation: getByRole('button') resolved to 2 elements:",
      `    1) <button>…</button> aka ${longName}`,
      "    2) <button>…</button> aka getByRole('button', { name: 'Short' })",
    ].join("\n"))
    const message = diagnose(error, click, 10_000)
    // A half candidate is a half secret: it is left out whole, not cut.
    expect(message).not.toContain(longName.slice(0, 60))
    expect(message).toContain("getByRole('button', { name: 'Short' })")
    expect(message).toContain("1 more")
  })

  it("keeps the page content of Playwright's message out of the diagnosis", () => {
    const error = new PlaywrightTimeout(
      [
        "locator.click: Timeout 10000ms exceeded.",
        "Call log:",
        "  - waiting for getByRole('button', { name: 'Sign in' })",
        '    - locator resolved to <button value="page-value-481" …>Sign in</button>',
        "    - attempting click action",
      ].join("\n"),
    )
    const message = diagnose(error, click, 10_000)
    expect(message).not.toContain("page-value-481")
    expect(message).not.toContain("<button")
  })
})
