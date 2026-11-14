import { describe, expect, it } from "vitest"
import type { Locator } from "playwright-core"
import { buildLocator, type LocatorRoot } from "../locator"
import { describeLocator } from "@shared/browser/describe_locator"
import type { BrowserLocator } from "@shared/types/BrowserLocator"

/**
 * A stand-in for Page / Locator / FrameLocator that records the chain of
 * calls made on it, so a test reads the Playwright code a locator becomes.
 */
function recorder(calls: string[] = []): LocatorRoot & Locator {
  const chain = (call: string) => () => {
    calls.push(call)
    return recorder(calls)
  }
  const fake = {
    calls,
    locator: (selector: string) => chain(`locator(${JSON.stringify(selector)})`)(),
    getByRole: (role: string, options?: object) => chain(`getByRole(${JSON.stringify(role)}, ${JSON.stringify(options)})`)(),
    getByLabel: (text: string, options?: object) => chain(`getByLabel(${JSON.stringify(text)}, ${JSON.stringify(options)})`)(),
    getByPlaceholder: (text: string, options?: object) => chain(`getByPlaceholder(${JSON.stringify(text)}, ${JSON.stringify(options)})`)(),
    getByText: (text: string, options?: object) => chain(`getByText(${JSON.stringify(text)}, ${JSON.stringify(options)})`)(),
    getByAltText: (text: string, options?: object) => chain(`getByAltText(${JSON.stringify(text)}, ${JSON.stringify(options)})`)(),
    getByTitle: (text: string, options?: object) => chain(`getByTitle(${JSON.stringify(text)}, ${JSON.stringify(options)})`)(),
    getByTestId: (id: string) => chain(`getByTestId(${JSON.stringify(id)})`)(),
    contentFrame: () => chain("contentFrame()")(),
    filter: (options: object) => chain(`filter(${JSON.stringify(options)})`)(),
    nth: (index: number) => chain(`nth(${index})`)(),
    last: () => chain("last()")(),
  }
  return fake as unknown as LocatorRoot & Locator
}

function calls(locator: BrowserLocator, resolve: (text: string) => string = (text) => text): string[] {
  const root = recorder()
  buildLocator(root, locator, resolve)
  return (root as unknown as { calls: string[] }).calls
}

describe("buildLocator", () => {
  it.each<[BrowserLocator, string[]]>([
    [{ kind: "role", role: "button", name: "Save" }, ['getByRole("button", {"name":"Save"})']],
    [{ kind: "role", role: "heading", exact: true }, ['getByRole("heading", {"exact":true})']],
    [{ kind: "label", value: "Email" }, ['getByLabel("Email", {})']],
    [{ kind: "placeholder", value: "Search", exact: false }, ['getByPlaceholder("Search", {"exact":false})']],
    [{ kind: "text", value: "Hello" }, ['getByText("Hello", {})']],
    [{ kind: "alt", value: "Logo" }, ['getByAltText("Logo", {})']],
    [{ kind: "title", value: "Close" }, ['getByTitle("Close", {})']],
    [{ kind: "testId", value: "submit" }, ['getByTestId("submit")']],
    [{ kind: "css", value: "#save" }, ['locator("#save")']],
    [{ kind: "selector", value: "internal:role=button" }, ['locator("internal:role=button")']],
  ])("maps %j to a public Playwright call", (locator, expected) => {
    expect(calls(locator)).toEqual(expected)
  })

  it("builds the chain outside-in: frame, within, kind, hasText, nth", () => {
    const locator: BrowserLocator = {
      kind: "role",
      role: "button",
      frame: "iframe#app",
      within: { kind: "role", role: "listitem", hasText: "Row B" },
      hasText: "Delete",
      nth: -1,
    }
    expect(calls(locator)).toEqual([
      'locator("iframe#app")',
      "contentFrame()",
      'getByRole("listitem", {})',
      'filter({"hasText":"Row B"})',
      'getByRole("button", {})',
      'filter({"hasText":"Delete"})',
      "last()",
    ])
  })

  it("resolves placeholders in every value", () => {
    const resolve = (text: string): string => text.replace("{{variables.name}}", "Ada")
    expect(calls({ kind: "role", role: "row", name: "{{variables.name}}", hasText: "{{variables.name}}", nth: 2 }, resolve)).toEqual([
      'getByRole("row", {"name":"Ada"})',
      'filter({"hasText":"Ada"})',
      "nth(2)",
    ])
  })
})

describe("describeLocator", () => {
  it.each<[BrowserLocator, string]>([
    [{ kind: "role", role: "button", name: "Save" }, "getByRole('button', { name: 'Save' })"],
    [{ kind: "role", role: "heading", name: "It's here", exact: true }, "getByRole('heading', { name: 'It\\'s here', exact: true })"],
    [{ kind: "label", value: "Email", exact: true }, "getByLabel('Email', { exact: true })"],
    [{ kind: "testId", value: "submit" }, "getByTestId('submit')"],
    [{ kind: "css", value: "#q" }, "locator('#q')"],
    [
      { kind: "role", role: "button", frame: "iframe", within: { kind: "role", role: "listitem" }, hasText: "Delete", nth: 1 },
      "locator('iframe').contentFrame().getByRole('listitem').getByRole('button').filter({ hasText: 'Delete' }).nth(1)",
    ],
    [{ kind: "text", value: "{{variables.name}}", nth: -1 }, "getByText('{{variables.name}}').last()"],
  ])("describes %j as Playwright code", (locator, expected) => {
    expect(describeLocator(locator)).toBe(expected)
  })
})
