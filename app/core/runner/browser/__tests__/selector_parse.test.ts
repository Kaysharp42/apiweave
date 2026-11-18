import { describe, expect, it } from "vitest"
import type { BrowserLocator } from "@shared/types/BrowserLocator"
import { parseRecordedSelector, roleSelectorWithName } from "../selector_parse"
import events from "./fixtures/recorder-events.json"

describe("parseRecordedSelector", () => {
  it.each<[string, BrowserLocator]>([
    // Captured from Playwright 1.64.1's recorder (Phase 0).
    ['internal:role=textbox[name="Email"i]', { kind: "role", role: "textbox", name: "Email" }],
    ['internal:role=checkbox[name="Remember me"i]', { kind: "role", role: "checkbox", name: "Remember me" }],
    ['internal:label="Plan"i', { kind: "label", value: "Plan" }],
    [
      'internal:role=listitem >> internal:has-text="Row B Delete"i >> internal:role=button',
      { kind: "role", role: "button", within: { kind: "role", role: "listitem", hasText: "Row B Delete" } },
    ],
    [
      'iframe[title="embedded"] >> internal:control=enter-frame >> internal:role=button[name="Inside frame"i]',
      { kind: "role", role: "button", name: "Inside frame", frame: 'iframe[title="embedded"]' },
    ],
    // The other kinds, written the way Playwright's escape functions write them.
    ['internal:role=button[name="Save"s]', { kind: "role", role: "button", name: "Save", exact: true }],
    ["internal:role=main", { kind: "role", role: "main" }],
    ['internal:label="Email address"s', { kind: "label", value: "Email address", exact: true }],
    ['internal:attr=[placeholder="Search orders"i]', { kind: "placeholder", value: "Search orders" }],
    ['internal:attr=[alt="Company logo"i]', { kind: "alt", value: "Company logo" }],
    ['internal:attr=[title="Close"s]', { kind: "title", value: "Close", exact: true }],
    ['internal:text="Welcome back"i', { kind: "text", value: "Welcome back" }],
    ['internal:testid=[data-testid="result"s]', { kind: "testId", value: "result" }],
    ["#save", { kind: "css", value: "#save" }],
    ['input[name="q"]', { kind: "css", value: 'input[name="q"]' }],
    ["css=.row", { kind: "css", value: ".row" }],
    ['internal:role=button[name="Delete"i] >> nth=1', { kind: "role", role: "button", name: "Delete", nth: 1 }],
    ['internal:text="Item"i >> nth=-1', { kind: "text", value: "Item", nth: -1 }],
    // Escapes: JSON in text selectors, only \\ and \" in attribute selectors.
    ['internal:text="Say \\"hi\\"\\n"i', { kind: "text", value: 'Say "hi"\n' }],
    ['internal:role=button[name="Say \\"hi\\" \\\\ now"i]', { kind: "role", role: "button", name: 'Say "hi" \\ now' }],
    // A quoted `>>` is part of the value, not a chain step.
    ['internal:text="a >> b"i', { kind: "text", value: "a >> b" }],
  ])("%s", (selector, expected) => {
    expect(parseRecordedSelector(selector)).toEqual(expected)
  })

  it.each([
    // A role property with no field here.
    "internal:role=heading[level=1]",
    'internal:role=button[name="Save"i][pressed=true]',
    // A name given as a regular expression.
    "internal:role=button[name=/save/i]",
    // A role Playwright does not accept.
    'internal:role=widget[name="x"i]',
    // An exact has-text: `hasText` is always a substring.
    'internal:role=listitem >> internal:has-text="Row B"s >> internal:role=button',
    // nth before has-text cannot be expressed: `hasText` is applied first.
    'internal:role=listitem >> nth=1 >> internal:has-text="B"i',
    // Nested frames, and a frame named by a non-CSS locator.
    "iframe >> internal:control=enter-frame >> iframe >> internal:control=enter-frame >> button",
    'internal:role=region >> internal:control=enter-frame >> button',
    // Engines with no structured equivalent.
    'internal:has="li"',
    "xpath=//button",
    "//button",
    'internal:testid=[data-qa="x"s]',
    // An unterminated quote.
    'internal:text="open',
  ])("keeps %s whole", (selector) => {
    expect(parseRecordedSelector(selector)).toEqual({ kind: "selector", value: selector })
  })

  it("returns null for a selector longer than any locator may be", () => {
    expect(parseRecordedSelector(`internal:text="${"x".repeat(5_000)}"i`)).toBeNull()
  })

  it("structures every selector the Phase 0 recording produced", () => {
    const selectors = new Set(
      events.flatMap((event) => ("action" in event && typeof event.action.selector === "string" ? [event.action.selector] : [])),
    )
    expect(selectors.size).toBeGreaterThan(5)
    for (const selector of selectors) {
      expect(parseRecordedSelector(selector)?.kind, selector).not.toBe("selector")
    }
  })
})

describe("roleSelectorWithName", () => {
  it("adds the accessible name to a bare role", () => {
    const selector = roleSelectorWithName("internal:role=heading", "Mechanical keyboard")
    expect(selector).toBe('internal:role=heading[name="Mechanical keyboard"i]')
    expect(parseRecordedSelector(selector ?? "")).toEqual({ kind: "role", role: "heading", name: "Mechanical keyboard" })
  })

  it("escapes a name the way Playwright's attribute selectors do", () => {
    const selector = roleSelectorWithName("internal:role=button", 'Say "hi" \\ now')
    expect(selector).toBe('internal:role=button[name="Say \\"hi\\" \\\\ now"i]')
    expect(parseRecordedSelector(selector ?? "")).toEqual({ kind: "role", role: "button", name: 'Say "hi" \\ now' })
  })

  it("trims the name the accessibility tree reports with whitespace around it", () => {
    expect(roleSelectorWithName("internal:role=link", "  Add to bag\n")).toBe('internal:role=link[name="Add to bag"i]')
  })

  it("accepts a name of exactly the length limit", () => {
    const name = "x".repeat(200)
    expect(roleSelectorWithName("internal:role=heading", name)).toBe(`internal:role=heading[name="${name}"i]`)
    expect(parseRecordedSelector(`internal:role=heading[name="${name}"i]`)).toEqual({ kind: "role", role: "heading", name })
  })

  it.each([
    ["a role that already has a name", 'internal:role=button[name="Save"i]', "Save"],
    ["a chain", "internal:role=heading >> nth=0", "Orders"],
    ["a role with another property", "internal:role=heading[level=1]", "Orders"],
    ["a selector that is not a bare role", "#msg", "Order 42 deleted"],
    ["an empty name", "internal:role=heading", "   "],
    ["a name longer than a locator should hold", "internal:role=heading", "x".repeat(201)],
  ])("keeps %s as it is", (_case, selector, name) => {
    expect(roleSelectorWithName(selector, name)).toBeNull()
  })
})
