// fallow-ignore-file weakened-tests -- this suite drives a real browser and skips itself when none is installed, so a machine without one still passes.
import type { Browser, Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import { ariaRoleAndName, betterSelector } from "../better_selector"
import { parseRecordedSelector } from "../selector_parse"
import { launchBrowser } from "../session"

/**
 * One of each element the recorder leaves a fragile selector on: a generic
 * div whose text repeats inside a longer one, a field named only by its
 * label, a field named only by its placeholder, a div inside a button, and
 * two buttons nothing tells apart.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>Fixture</title>
<div class="row"><div>Kilométrage/an</div><div>Kilométrage/an estimé</div></div>
<label for="plan">Plan</label><input id="plan">
<input placeholder="Search orders">
<button><div class="inner">Continuer</div></button>
<button class="twin">Same</button><button class="twin">Same</button>
<div class="blank" style="width:10px;height:10px"></div>`

let channel: BrowserChannel | undefined
let browser: Browser | undefined
let page: Page

beforeAll(async () => {
  channel = await findTestBrowser()
  if (channel === undefined) return
  browser = await launchBrowser({ headless: true, channel })
  page = await browser.newPage()
  await page.setContent(PAGE)
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await browser?.close()
})

describe("ariaRoleAndName", () => {
  it("reads the role and the quoted name of the first line", () => {
    expect(ariaRoleAndName('- heading "Say \\"hi\\"" [level=1]\n- text: x')).toEqual({ role: "heading", name: 'Say "hi"' })
    expect(ariaRoleAndName("- generic: Plan")).toBeNull()
  })
})

describe("betterSelector", () => {
  it.each([
    ["a regex has-text on a generic div → its exact text", "div >> internal:has-text=/^Kilométrage\\/an$/ >> nth=0", false, { kind: "text", value: "Kilométrage/an", exact: true }],
    ["a positioned div → its exact text", "div.row >> div >> nth=1", false, { kind: "text", value: "Kilométrage/an estimé", exact: true }],
    ["a positioned input → its label", "input >> nth=0", false, { kind: "role", role: "textbox", name: "Plan" }],
    ["an input with only a placeholder → the placeholder's role name", "input >> nth=1", false, { kind: "role", role: "textbox", name: "Search orders" }],
    ["a click inside a button → the button", "div >> internal:has-text=\"Continuer\"i >> nth=-1", true, { kind: "role", role: "button", name: "Continuer" }],
  ])(
    "%s",
    async (_what, selector, isClick, expected) => {
      if (browser === undefined) return
      const chosen = await betterSelector(page, selector, isClick)
      expect(parseRecordedSelector(chosen)).toEqual(expected)
      // One element: the recorded one, or for a click the control it sits in.
      expect(await page.locator(chosen).count()).toBe(1)
      const recorded = await page.locator(selector).elementHandle()
      const same = await page.locator(chosen).evaluate((found, element) => found === element, recorded)
      const around = await page.locator(chosen).evaluate((found, element) => found !== element && found.contains(element), recorded)
      expect(isClick ? around : same).toBe(true)
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "keeps the recorded selector when every candidate finds more than one element",
    async () => {
      if (browser === undefined) return
      expect(await betterSelector(page, "button.twin >> nth=1", true)).toBe("button.twin >> nth=1")
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "keeps the recorded selector for an element with nothing to name it by, or one the page no longer has",
    async () => {
      if (browser === undefined) return
      expect(await betterSelector(page, "div.blank >> nth=0", true)).toBe("div.blank >> nth=0")
      expect(await betterSelector(page, "section >> nth=3", true)).toBe("section >> nth=3")
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it("leaves a selector that is not fragile alone without asking the page", async () => {
    // No page at all: a sturdy selector must not reach it.
    const unused = undefined as unknown as Page
    expect(await betterSelector(unused, 'internal:role=button[name="Save"i]', true)).toBe('internal:role=button[name="Save"i]')
    expect(await betterSelector(unused, "#email", false)).toBe("#email")
  })
})
