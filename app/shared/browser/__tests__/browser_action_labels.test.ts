import { describe, expect, it } from "vitest"
import { browserStepLabel } from "../browser_action_labels"

const email = { kind: "role", role: "textbox", name: "Email" }

describe("browserStepLabel", () => {
  it.each([
    ["navigate to a path", { action: "navigate", url: "{{env.BASE_URL}}/login" }, "Open /login"],
    ["navigate to a site root", { action: "navigate", url: "https://shop.example.test/" }, "Open shop.example.test"],
    ["navigate to a bare host", { action: "navigate", url: "https://shop.example.test" }, "Open shop.example.test"],
    ["click a button", { action: "click", locator: { kind: "role", role: "button", name: "Continuer" } }, "Click Continuer"],
    ["double-click", { action: "click", clickCount: 2, locator: { kind: "text", value: "Row 1" } }, "Double-click Row 1"],
    ["fill a textbox", { action: "fill", locator: email, value: "ada@example.test" }, "Fill Email"],
    ["press a key", { action: "press", key: "Enter" }, "Press Enter"],
    ["press a key in a field", { action: "press", key: "Tab", locator: email }, "Press Tab"],
    ["select by label", { action: "select", locator: { kind: "label", value: "Plan" }, values: ["pro"] }, "Choose Plan"],
    ["check", { action: "check", locator: { kind: "label", value: "Terms" } }, "Tick Terms"],
    ["uncheck", { action: "uncheck", locator: { kind: "label", value: "Newsletter" } }, "Untick Newsletter"],
    ["hover", { action: "hover", locator: { kind: "title", value: "Help" } }, "Hover Help"],
    ["expect visible", { action: "expect-visible", locator: { kind: "role", role: "heading", name: "Total" } }, "Expect Total visible"],
    ["expect hidden", { action: "expect-visible", visible: false, locator: { kind: "testId", value: "spinner" } }, "Expect spinner hidden"],
    ["expect text", { action: "expect-text", locator: { kind: "alt", value: "Logo" }, text: "x", match: "contains" }, "Expect Logo text"],
    ["expect value", { action: "expect-value", locator: { kind: "placeholder", value: "Search" }, value: "x" }, "Expect Search value"],
    ["expect url", { action: "expect-url", url: "{{env.BASE_URL}}/done?order=1", match: "contains" }, "Expect URL /done"],
    ["extract", { action: "extract", from: "text", variable: "n", locator: { kind: "role", role: "heading", name: "Order number" } }, "Save Order number"],
    ["css with hasText", { action: "click", locator: { kind: "css", value: "div", hasText: "Kilométrage/an", nth: 4 } }, "Click Kilométrage/an"],
    ["raw selector with hasText", { action: "click", locator: { kind: "selector", value: "div >> nth=0", hasText: "Plan" } }, "Click Plan"],
    ["a name held in a variable", { action: "click", locator: { kind: "role", role: "option", name: "{{variables.client}}" } }, "Click client"],
    ["a label held in an env variable", { action: "fill", locator: { kind: "label", value: "{{ env.FIELD }}" }, value: "x" }, "Fill FIELD"],
  ])("%s → %s", (_what, config, expected) => {
    expect(browserStepLabel(config)).toBe(expected)
  })

  it.each([
    ["a role with no name", { action: "click", locator: { kind: "role", role: "button" } }, "Click"],
    ["a bare css selector", { action: "fill", locator: { kind: "css", value: "#email" }, value: "x" }, "Type into a field"],
    ["an expect-url pattern", { action: "expect-url", url: "^/orders/\\d+$", match: "matches" }, "Check the page address"],
    ["an extract of the page title", { action: "extract", from: "title", variable: "title" }, "Save a value"],
    ["a missing action", {}, "Browser step"],
    ["no config at all", undefined, "Browser step"],
  ])("falls back to the action's words for %s", (_what, config, expected) => {
    expect(browserStepLabel(config)).toBe(expected)
  })

  it("collapses whitespace and cuts a long name with an ellipsis", () => {
    const label = browserStepLabel({ action: "click", locator: { kind: "text", value: "Accept all\n  the cookies the site wants to keep for ever" } })
    expect(label).toBe("Click Accept all the cookies the site…")
    expect(label.length).toBeLessThanOrEqual(40)
  })

  it.each([
    ["a fill's value", { action: "fill", locator: email, value: "hunter2-secret" }, "hunter2"],
    ["a select's options", { action: "select", locator: { kind: "label", value: "Plan" }, values: ["secret-plan"] }, "secret-plan"],
    ["an expected text", { action: "expect-text", locator: email, text: "s3cret-text", match: "equals" }, "s3cret"],
    ["an expected value", { action: "expect-value", locator: email, value: "s3cret-value" }, "s3cret"],
    ["a navigate's query and credentials", { action: "navigate", url: "https://user:pa55@host.test/?token=abc" }, "pa55"],
    ["a navigate's query token", { action: "navigate", url: "https://host.test/cb?token=abc#frag" }, "abc"],
  ])("never names %s", (_what, config, secret) => {
    expect(browserStepLabel(config)).not.toContain(secret)
  })
})
