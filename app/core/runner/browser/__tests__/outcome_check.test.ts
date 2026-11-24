import { describe, expect, it } from "vitest"
import { outcomeCheck, pathOf, readActionLandmarks, readLandmarks, type Landmark, type PageState } from "../outcome_check"
import type { RecordingValues } from "../recording_values"

const NO_VALUES: RecordingValues = { env: {}, secrets: {} }

const heading = (name: string, level = 2): Landmark => ({ role: "heading", name, text: "", level })
const alert = (text: string): Landmark => ({ role: "alert", name: "", text })
const page = (path: string, landmarks: Landmark[]): PageState => ({ path, landmarks })

describe("readLandmarks", () => {
  // The shape `ariaSnapshot({ mode: "ai" })` and Playwright's recorder write, quoting and escaping included.
  const SNAPSHOT = [
    "- generic [active] [ref=e1]:",
    '  - heading "Offre" [level=1] [ref=e2]',
    "  - 'heading \"Step 2: \\\"go\\\" #1\" [level=2] [ref=e3]'",
    "  - textbox [ref=e4]: typed-password",
    "  - alert [ref=e5]:",
    "    - text: Offre",
    '    - link "envoyée" [ref=e6]:',
    "      - /url: /offers/1",
    "  - status",
    '  - status [ref=e7]: "- yes: no"',
    '  - dialog "Confirm" [ref=e8]:',
    '    - heading "Sure?" [level=2] [ref=e9]',
    '    - button "OK" [ref=e10]',
  ].join("\n")

  it("keeps headings, messages and dialogs from an ARIA snapshot, in document order, and nothing else", () => {
    expect(readLandmarks(SNAPSHOT)).toEqual([
      { role: "heading", name: "Offre", text: "", level: 1 },
      { role: "heading", name: 'Step 2: "go" #1', text: "", level: 2 },
      { role: "alert", name: "", text: "Offre envoyée" },
      { role: "status", name: "", text: "" },
      { role: "status", name: "", text: "- yes: no" },
      { role: "dialog", name: "Confirm", text: "" },
      { role: "heading", name: "Sure?", text: "", level: 2 },
    ])
    expect(JSON.stringify(readLandmarks(SNAPSHOT))).not.toContain("typed-password")
  })

  it("reads only the landmarks of a raw recorder action, and none from one without a snapshot", () => {
    expect(readActionLandmarks({ name: "click", selector: "internal:role=button", ariaSnapshot: SNAPSHOT })).toHaveLength(7)
    expect(readActionLandmarks({ name: "click" })).toBeNull()
    expect(readLandmarks("- [unclosed")).toBeNull()
  })

  it("reads a path without its query or fragment, and no path for a page that is not http(s)", () => {
    expect(pathOf("https://shop.test/offers/new?step=2#top")).toBe("/offers/new")
    expect(pathOf("about:blank")).toBeNull()
  })
})

describe("outcomeCheck", () => {
  it("checks the new path when the address changed", () => {
    const check = outcomeCheck(page("/login", [heading("Sign in", 1)]), page("/dashboard", [heading("Dashboard", 1)]), [], NO_VALUES)
    expect(check).toEqual({ config: { action: "expect-url", url: "/dashboard", match: "contains" }, probe: null })
  })

  it("checks a heading that appeared when the address stayed the same", () => {
    const check = outcomeCheck(page("/wizard", [heading("Step 1")]), page("/wizard", [heading("Step 2")]), [], NO_VALUES)
    expect(check).toEqual({
      config: { action: "expect-visible", locator: { kind: "role", role: "heading", name: "Step 2", exact: true } },
      probe: { kind: "role", role: "heading", name: "Step 2", exact: true },
    })
  })

  it("prefers a new alert to a new heading, and a higher heading to a lower one", () => {
    const before = page("/offers", [heading("Offers", 1)])
    const withAlert = outcomeCheck(before, page("/offers", [heading("Offers", 1), heading("Summary", 3), alert("Offre envoyée")]), [], NO_VALUES)
    expect(withAlert?.config).toEqual({ action: "expect-visible", locator: { kind: "role", role: "alert", hasText: "Offre envoyée" } })
    const headings = outcomeCheck(before, page("/offers", [heading("Offers", 1), heading("Details", 3), heading("Summary", 2)]), [], NO_VALUES)
    expect(headings?.config).toMatchObject({ locator: { name: "Summary" } })
  })

  it("adds nothing when nothing visible changed, or when only the root path is new", () => {
    const state = page("/wizard", [heading("Step 1")])
    expect(outcomeCheck(state, page("/wizard", [heading("Step 1")]), [], NO_VALUES)).toBeNull()
    expect(outcomeCheck(page("/login", []), page("/", []), [], NO_VALUES)).toBeNull()
    // Where the user acted is not known (the first page, still blank): no address to compare.
    expect(outcomeCheck({ path: null, landmarks: [] }, page("/dashboard", []), [], NO_VALUES)).toBeNull()
  })

  it("skips a name that holds a typed value or a secret, and takes the next landmark", () => {
    const before = page("/profile", [])
    const after = page("/profile", [alert("Welcome back, Jean-Pierre"), heading("Profile")])
    expect(outcomeCheck(before, after, ["Jean-Pierre"], NO_VALUES)?.config).toMatchObject({ locator: { role: "heading", name: "Profile" } })
    expect(outcomeCheck(before, page("/profile", [heading("tok-123456")]), [], { env: {}, secrets: { TOKEN: "tok-123456" } })).toBeNull()
    expect(outcomeCheck(page("/search", []), page("/search/paris", []), ["Paris"], NO_VALUES)).toBeNull()
  })

  it("skips a landmark the page cannot tell apart from another of its kind", () => {
    const before = page("/cart", [heading("Item")])
    expect(outcomeCheck(before, page("/cart", [heading("Item"), heading("Item")]), [], NO_VALUES)).toBeNull()
  })

  it("templates a name equal to an environment value", () => {
    const check = outcomeCheck(page("/", []), page("/", [heading("Acme Corp", 1)]), [], { env: { COMPANY: "Acme Corp" }, secrets: {} })
    expect(check).toEqual({
      config: { action: "expect-visible", locator: { kind: "role", role: "heading", name: "{{env.COMPANY}}", exact: true } },
      probe: { kind: "role", role: "heading", name: "Acme Corp", exact: true },
    })
  })

  it("skips an address that ends in an id this run made up, and checks the landmark instead", () => {
    expect(outcomeCheck(page("/orders", []), page("/orders/123456", []), [], NO_VALUES)).toBeNull()
    expect(outcomeCheck(page("/orders", []), page("/offers/3f2504e0-4f89-11d3-9a0c-0305e82c3301", []), [], NO_VALUES)).toBeNull()
    expect(outcomeCheck(page("/share", []), page("/share/a1b2c3d4e5f6g7h8", []), [], NO_VALUES)).toBeNull()
    // Two digits are a step or a year, not an id.
    expect(outcomeCheck(page("/offers", []), page("/offers/12", []), [], NO_VALUES)?.config).toEqual({
      action: "expect-url",
      url: "/offers/12",
      match: "contains",
    })
    // The address is skipped, so the heading beside it is what proves the click.
    expect(outcomeCheck(page("/orders", []), page("/orders/123456", [heading("Order details")]), [], NO_VALUES)?.config).toEqual({
      action: "expect-visible",
      locator: { kind: "role", role: "heading", name: "Order details", exact: true },
    })
  })

  it("compares an address with its escapes undone, and skips an id written encoded", () => {
    expect(outcomeCheck(page("/search", []), page("/search/Jos%C3%A9", []), ["José"], NO_VALUES)).toBeNull()
    expect(outcomeCheck(page("/orders", []), page("/orders/%31%32%33", []), [], NO_VALUES)).toBeNull()
  })

  it("skips a landmark whose name holds an id this run made up, and keeps a step number", () => {
    expect(outcomeCheck(page("/invoice", []), page("/invoice", [heading("Invoice 1234")]), [], NO_VALUES)).toBeNull()
    expect(
      outcomeCheck(page("/invoice", []), page("/invoice", [heading("Paid 3f2504e0-4f89-11d3-9a0c-0305e82c3301")]), [], NO_VALUES),
    ).toBeNull()
    expect(outcomeCheck(page("/wizard", []), page("/wizard", [heading("Step 2")]), [], NO_VALUES)?.config).toEqual({
      action: "expect-visible",
      locator: { kind: "role", role: "heading", name: "Step 2", exact: true },
    })
  })
})
