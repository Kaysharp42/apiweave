import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chromium, type Browser, type Page } from "playwright-core"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import { capturePage } from "../capture"

const SHOWN_SECRET = "tok-visible-5519"

/** The secret on show twice — as text and in a field — with plenty of other text around it. */
const PAGE = `<!doctype html><title>Keys</title>
<h1>Keys</h1>
<p>Your token is <b id="shown">${SHOWN_SECRET}</b> — keep it safe.</p>
<label for="f">Token</label><input id="f" value="${SHOWN_SECRET}" style="width:300px">
<p>Unrelated text that stays visible.</p>`

let channel: BrowserChannel | undefined
let browser: Browser | undefined
let page: Page

beforeAll(async () => {
  channel = await findTestBrowser()
  if (channel === undefined) return
  browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) })
  page = await browser.newPage({ viewport: { width: 800, height: 400 } })
  await page.setContent(PAGE)
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await browser?.close()
})

describe("capturePage", { timeout: BROWSER_TEST_TIMEOUT_MS }, () => {
  it("paints over what shows a sensitive value, and leaves the page as it was", async (context) => {
    if (channel === undefined) context.skip()
    const plain = await capturePage(page, [])
    const masked = await capturePage(page, [SHOWN_SECRET])
    expect(plain.screenshot).toBeDefined()
    expect(masked.screenshot).toBeDefined()
    expect(masked.screenshot!.equals(plain.screenshot!)).toBe(false)
    // The marks used to find those elements are gone again.
    expect(await page.locator("[data-apiweave-sensitive]").count()).toBe(0)
    // The snapshot is left for the run's masker, which works on text.
    expect(masked.ariaSnapshot).toContain(SHOWN_SECRET)
  })

  it("does not paint over anything for a value the page does not show, or one too short to mask", async (context) => {
    if (channel === undefined) context.skip()
    const plain = await capturePage(page, [])
    const unrelated = await capturePage(page, ["not-on-this-page", "Key"])
    expect(unrelated.screenshot!.equals(plain.screenshot!)).toBe(true)
  })

  it("leaves the screenshot out when not asked for", async (context) => {
    if (channel === undefined) context.skip()
    const capture = await capturePage(page, [SHOWN_SECRET], { screenshot: false })
    expect(capture.screenshot).toBeUndefined()
    expect(capture.note).toBeUndefined()
    expect(capture.ariaSnapshot).toContain("Keys")
  })
})
