// fallow-ignore-file weakened-tests -- this suite drives a real browser and skips itself when none is installed, so a machine without one still passes.
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { chromium, type Browser, type Page } from "playwright-core"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import { capturePage } from "../capture"

const SHOWN_SECRET = "tok-visible-5519"
const SHADOW_SECRET = "tok-shadow-8823"
const FRAME_SECRET = "tok-in-frame-4417"
const FRAME_PASSWORD = "frame-password-9931"

/** The secret on show twice — as text and in a field — with plenty of other text around it. */
const PAGE = `<!doctype html><title>Keys</title>
<h1>Keys</h1>
<p>Your token is <b id="shown">${SHOWN_SECRET}</b> — keep it safe.</p>
<label for="f">Token</label><input id="f" value="${SHOWN_SECRET}" style="width:300px">
<p>Unrelated text that stays visible.</p>`

/** A web-component UI: the secret is a text node inside an open shadow root, put there by the test. */
const SHADOW_PAGE = `<!doctype html><title>Shadow</title>
<h1>Keys</h1>
<div id="host"></div>
<p>Unrelated text that stays visible.</p>`

/** The secret in a frame rather than the page, which is what a page-level locator cannot reach. */
const FRAMED_PAGE = `<!doctype html><title>Framed</title>
<h1>Keys</h1>
<iframe id="inner" style="width:400px;height:120px;border:0" srcdoc="<p>Your token is <b>${FRAME_SECRET}</b></p>"></iframe>
<p>Unrelated text that stays visible.</p>`

/** A password field in a frame: Playwright's page-level password locator does not enter one. */
const FRAMED_PASSWORD_PAGE = `<!doctype html><title>Framed password</title>
<h1>Keys</h1>
<iframe id="inner" style="width:400px;height:120px;border:0" srcdoc="<input type=password value=${FRAME_PASSWORD} style=width:300px>"></iframe>`

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

/** A page of its own, so a test's content cannot disturb the shared page. */
async function openPage(html: string): Promise<Page> {
  const created = await browser!.newPage({ viewport: { width: 800, height: 400 } })
  await created.setContent(html)
  return created
}

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

  it("keeps the ARIA snapshot it is given instead of reading the page again", async (context) => {
    if (channel === undefined) context.skip()
    const given = await capturePage(page, [], { screenshot: false, ariaSnapshot: "- generic: already read" })
    expect(given.ariaSnapshot).toBe("- generic: already read")
    expect(given.note).toBeUndefined()
    // An empty given snapshot is no snapshot: the page is read as before.
    const read = await capturePage(page, [], { screenshot: false, ariaSnapshot: "" })
    expect(read.ariaSnapshot).toContain("Keys")
  })

  it("paints over a secret shown inside an open shadow root", async (context) => {
    if (channel === undefined) context.skip()
    const shadow = await openPage(SHADOW_PAGE)
    try {
      await shadow.evaluate((secret: string) => {
        const host = document.querySelector("#host")
        const root = host instanceof HTMLElement ? host.attachShadow({ mode: "open" }) : null
        if (root === null) return
        const shown = document.createElement("p")
        shown.textContent = `Your token is ${secret}`
        root.append(shown)
      }, SHADOW_SECRET)
      // A CSS locator pierces an open shadow root, which is why one mark locator
      // per frame is enough to paint over what is inside one.
      await shadow.evaluate(() => {
        document.querySelector("#host")?.shadowRoot?.querySelector("p")?.setAttribute("data-apiweave-sensitive", "0")
      })
      expect(await shadow.locator("[data-apiweave-sensitive]").count()).toBe(1)
      await shadow.evaluate(() => {
        document.querySelector("#host")?.shadowRoot?.querySelector("p")?.removeAttribute("data-apiweave-sensitive")
      })
      const plain = await capturePage(shadow, [])
      const masked = await capturePage(shadow, [SHADOW_SECRET])
      expect(masked.screenshot).toBeDefined()
      expect(masked.screenshot!.equals(plain.screenshot!)).toBe(false)
      // The mark inside the shadow tree was cleared too.
      expect(await shadow.locator("[data-apiweave-sensitive]").count()).toBe(0)
    } finally {
      await shadow.close()
    }
  })

  it("paints over a secret shown inside an iframe", async (context) => {
    if (channel === undefined) context.skip()
    const framed = await openPage(FRAMED_PAGE)
    try {
      // The secret is in the frame, past the reach of a page-level locator.
      expect(await framed.locator(`text=${FRAME_SECRET}`).count()).toBe(0)
      expect(await framed.frames()[1]!.locator(`text=${FRAME_SECRET}`).count()).toBe(1)
      const plain = await capturePage(framed, [])
      const masked = await capturePage(framed, [FRAME_SECRET])
      expect(masked.screenshot).toBeDefined()
      expect(masked.screenshot!.equals(plain.screenshot!)).toBe(false)
      // Every frame was left as it was.
      for (const frame of framed.frames()) expect(await frame.locator("[data-apiweave-sensitive]").count()).toBe(0)
    } finally {
      await framed.close()
    }
  })

  it("paints over a password field inside an iframe", async (context) => {
    if (channel === undefined) context.skip()
    const framed = await openPage(FRAMED_PASSWORD_PAGE)
    try {
      // A page-level password locator does not enter the frame; the frame's does.
      expect(await framed.locator('input[type="password" i]').count()).toBe(0)
      expect(await framed.frames()[1]!.locator('input[type="password" i]').count()).toBe(1)
      // The password rule needs no value, so a plain screenshot of the same page
      // is what an unmasked capture would look like.
      const unmasked = await framed.screenshot({ type: "jpeg", quality: 70 })
      const capture = await capturePage(framed, [])
      expect(capture.screenshot).toBeDefined()
      expect(capture.screenshot!.equals(unmasked)).toBe(false)
    } finally {
      await framed.close()
    }
  })
})
