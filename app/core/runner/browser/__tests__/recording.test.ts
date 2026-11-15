import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep"
import { BrowserRecording } from "../recording"
import type { RecordingValues } from "../recording_values"
import { BrowserSession } from "../session"
import { runBrowserStep, type BrowserStepContext } from "../step"

const EMAIL = "ada@acme.test"
const PASSWORD = "fixture-pass-2468"

const LOGIN_PAGE = `<!doctype html><title>Sign in</title>
<h1>Sign in to Acme</h1>
<form onsubmit="event.preventDefault(); location.href = '/dashboard'">
  <label for="email">Email address</label><input id="email" type="email">
  <label for="pw">Password</label><input id="pw" type="password">
  <button type="submit">Sign in</button>
</form>`
const DASHBOARD_PAGE = `<!doctype html><title>Dashboard</title><h1>Dashboard</h1>`

let channel: BrowserChannel | undefined
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = (request.url ?? "/").split("?")[0]
    if (path === "/") response.writeHead(302, { location: "/login" }).end()
    else if (path === "/login") response.writeHead(200, { "content-type": "text/html" }).end(LOGIN_PAGE)
    else if (path === "/dashboard") response.writeHead(200, { "content-type": "text/html" }).end(DASHBOARD_PAGE)
    else response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

/** Record the login flow, typing with real key events the way a user does. */
async function recordLogin(values: RecordingValues): Promise<{ sent: RecordedBrowserStep[]; steps: BrowserNodeData[]; ended: boolean }> {
  const sent: RecordedBrowserStep[] = []
  let ended = false
  let next = 0
  const recording = await BrowserRecording.start({
    launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
    startUrl: `${base}/`,
    values,
    takenSecretNames: new Set(),
    newStepId: () => `browser-test-${++next}`,
    listener: { step: (step) => sent.push(step), warning: () => undefined, ended: () => (ended = true) },
    throttleMs: 20,
  })
  const page = recording.page
  if (page === null) throw new Error("no page")
  await page.getByLabel("Email address").click()
  await page.keyboard.type(EMAIL, { delay: 15 })
  await page.getByLabel("Password").click()
  await page.keyboard.type(PASSWORD, { delay: 15 })
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(`${base}/dashboard`)
  await recording.stop()
  const steps = new Map<string, BrowserNodeData>()
  for (const step of sent) steps.set(step.stepId, step.config)
  return { sent, steps: [...steps.values()], ended }
}

describe("BrowserRecording", () => {
  it(
    "records a login as one step per action, with the email and password as templates",
    async (context) => {
      if (channel === undefined) context.skip()
      const { sent, steps, ended } = await recordLogin({
        env: { BASE_URL: base, TEST_EMAIL: EMAIL },
        secrets: { TEST_PASSWORD: PASSWORD },
      })
      expect(steps).toEqual([
        { action: "navigate", url: "{{env.BASE_URL}}/login" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Email address" }, value: "{{env.TEST_EMAIL}}" },
        { action: "fill", locator: { kind: "role", role: "textbox", name: "Password" }, value: "{{secrets.TEST_PASSWORD}}" },
        { action: "click", locator: { kind: "role", role: "button", name: "Sign in" } },
      ])
      expect(ended).toBe(true)
      // Not one keystroke of the password went out.
      expect(JSON.stringify(sent)).not.toContain(PASSWORD.slice(0, 4))
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "gives a password that is no stored secret a placeholder, and never sends what was typed",
    async (context) => {
      if (channel === undefined) context.skip()
      const { sent, steps } = await recordLogin({ env: {}, secrets: {} })
      expect(steps[2]).toEqual({
        action: "fill",
        locator: { kind: "role", role: "textbox", name: "Password" },
        value: "{{secrets.UNSET_PASSWORD_1}}",
      })
      // Any four characters of it would be a leak; shorter fragments occur in any JSON.
      for (const end of [4, 8, PASSWORD.length]) expect(JSON.stringify(sent)).not.toContain(PASSWORD.slice(0, end))
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "records steps that pass when run",
    async (context) => {
      if (channel === undefined) context.skip()
      const env: Record<string, string> = { BASE_URL: base, TEST_EMAIL: EMAIL }
      const secrets: Record<string, string> = { TEST_PASSWORD: PASSWORD }
      const { steps } = await recordLogin({ env, secrets })
      const ctx: BrowserStepContext = {
        resolve: (text, allowSecrets) =>
          text.replace(/\{\{(env|secrets)\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (whole, scope: string, name: string) =>
            (scope === "env" ? env[name] : allowSecrets ? secrets[name] : undefined) ?? whole,
          ),
        assertHostAllowed: () => undefined,
        maskValue: () => undefined,
        regexTest: async (pattern, text) => new RegExp(pattern).test(text),
        setVariable: () => undefined,
      }
      const session = new BrowserSession({ headless: true, ...(channel === undefined ? {} : { channel }) })
      try {
        const check: BrowserNodeData = { action: "expect-text", locator: { kind: "role", role: "heading" }, text: "Dashboard", match: "equals" }
        for (const step of [...steps, check]) {
          const outcome = await session.run((page) => runBrowserStep(page, step, ctx))
          expect(outcome.error, step.action).toBeUndefined()
        }
      } finally {
        await session.close()
      }
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "ends when the user closes the browser",
    async (context) => {
      if (channel === undefined) context.skip()
      let ended = 0
      const recording = await BrowserRecording.start({
        launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
        startUrl: `${base}/login`,
        values: { env: {}, secrets: {} },
        takenSecretNames: new Set(),
        newStepId: () => "only",
        listener: { step: () => undefined, warning: () => undefined, ended: () => ended++ },
      })
      await recording.page?.close()
      await recording.stop()
      expect(ended).toBe(1)
    },
    BROWSER_TEST_TIMEOUT_MS,
  )

  it(
    "fails to start, leaving nothing open and telling the listener nothing",
    async (context) => {
      if (channel === undefined) context.skip()
      const sent: RecordedBrowserStep[] = []
      let ended = 0
      await expect(
        BrowserRecording.start({
          launch: { headless: true, ...(channel === undefined ? {} : { channel }) },
          startUrl: "http://127.0.0.1:1/",
          values: { env: {}, secrets: {} },
          takenSecretNames: new Set(),
          newStepId: () => "x",
          listener: { step: (step) => sent.push(step), warning: () => undefined, ended: () => ended++ },
        }),
      ).rejects.toThrow(/^Browser step: the start page could not be opened/)
      // Closing the browser after a failed start must not look like the user ending a recording.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(ended).toBe(0)
      expect(sent).toEqual([])
    },
    BROWSER_TEST_TIMEOUT_MS,
  )
})
