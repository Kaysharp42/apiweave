import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { Browser, Page } from "playwright-core"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import { pickElement } from "../pick"
import type { RecordingValues } from "../recording_values"
import { launchBrowser } from "../session"

const PAGE = `<!doctype html><title>Orders</title><h1>Orders</h1>
<button onclick="document.getElementById('msg').textContent = 'deleted'">Delete order</button>
<button>Key tok-123456</button>
<p id="msg">idle</p>`

const NO_VALUES: RecordingValues = { env: {}, secrets: {} }

let channel: BrowserChannel | undefined
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(PAGE))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** Move onto `name`'s button and click it, as the user does in pick mode. */
async function clickButton(page: Page, name: string): Promise<void> {
  // Pick mode is switched on in the page asynchronously.
  await page.waitForTimeout(300)
  const box = await page.getByRole("button", { name }).boundingBox()
  if (box === null) throw new Error(`no ${name} button`)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
}

describe("pickElement", { timeout: BROWSER_TEST_TIMEOUT_MS }, () => {
  let browser: Browser
  let page: Page

  beforeEach(async (context) => {
    if (channel === undefined) context.skip()
    browser = await launchBrowser({ channel, headless: true })
    page = await browser.newPage()
    await page.goto(base)
  })

  afterEach(async () => {
    await browser?.close()
  })

  it("picks the element the user clicks, without clicking it", async () => {
    const picking = pickElement(page, NO_VALUES)
    await clickButton(page, "Delete order")
    await expect(picking).resolves.toEqual({ kind: "locator", locator: { kind: "role", role: "button", name: "Delete order" } })
    await expect(page.locator("#msg").textContent()).resolves.toBe("idle")
  })

  it("refuses an element whose locator would show a secret", async () => {
    const picking = pickElement(page, { env: {}, secrets: { TOKEN: "tok-123456" } })
    await clickButton(page, "Key tok-123456")
    await expect(picking).resolves.toEqual({ kind: "secret" })
  })

  it("is cancelled when the page closes or the pick is called off", async () => {
    const closed = pickElement(page, NO_VALUES)
    await page.waitForTimeout(200)
    await page.cancelPickLocator()
    await expect(closed).resolves.toEqual({ kind: "cancelled" })

    const picking = pickElement(page, NO_VALUES)
    await page.waitForTimeout(200)
    await page.close()
    await expect(picking).resolves.toEqual({ kind: "cancelled" })
  })
})
