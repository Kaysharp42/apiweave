import { describe, expect, it } from "vitest"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep"
import { RecordingConverter, readRecorderAction, readRecorderSignal, type RecorderEvent } from "../recorded"
import { templateCheck, templateFill, templateUrl, type RecordingValues } from "../recording_values"
import events from "./fixtures/recorder-events.json"

const BASE = "http://127.0.0.1:54460"
const NO_VALUES: RecordingValues = { env: {}, secrets: {} }

function converter(values: RecordingValues = NO_VALUES, taken: ReadonlySet<string> = new Set()): RecordingConverter {
  let next = 0
  return new RecordingConverter(values, () => `step-${++next}`, taken)
}

/** Replay the Phase 0 recording; the password field is the one named "Password". */
function replay(values: RecordingValues): { sent: RecordedBrowserStep[]; steps: Map<string, BrowserNodeData>; warnings: string[] } {
  const recording = converter(values)
  const sent: RecordedBrowserStep[] = []
  const warnings: string[] = []
  for (const event of events) {
    if (!("action" in event)) continue
    const action = readRecorderAction(event.action)
    if (action === null) throw new Error("unreadable fixture action")
    const output = recording.apply({
      kind: event.event === "actionUpdated" ? "updated" : "added",
      action,
      onMainPage: true,
      ...(action.name === "fill" ? { isPassword: action.selector?.includes('"Password"') === true } : {}),
    })
    sent.push(...output.steps)
    warnings.push(...output.warnings)
  }
  sent.push(...recording.finish().steps)
  const steps = new Map<string, BrowserNodeData>()
  for (const step of sent) steps.set(step.stepId, step.config)
  return { sent, steps, warnings }
}

describe("RecordingConverter on the Phase 0 recording", () => {
  it("produces one step per user action, with the email and password as templates", () => {
    const { steps, warnings } = replay({
      env: { BASE_URL: BASE, TEST_EMAIL: "me@example.com" },
      secrets: { TEST_PASSWORD: "hunter22" },
    })
    expect([...steps.values()]).toEqual([
      { action: "navigate", url: "{{env.BASE_URL}}/" },
      { action: "fill", locator: { kind: "role", role: "textbox", name: "Email" }, value: "{{env.TEST_EMAIL}}" },
      { action: "fill", locator: { kind: "role", role: "textbox", name: "Password" }, value: "{{secrets.TEST_PASSWORD}}" },
      { action: "fill", locator: { kind: "role", role: "textbox", name: "Search orders" }, value: "A1" },
      { action: "check", locator: { kind: "role", role: "checkbox", name: "Remember me" } },
      { action: "select", locator: { kind: "label", value: "Plan" }, values: ["Pro"] },
      { action: "click", locator: { kind: "role", role: "button", name: "Sign in" } },
      { action: "click", locator: { kind: "role", role: "button", within: { kind: "role", role: "listitem", hasText: "Row B Delete" } } },
      { action: "click", locator: { kind: "role", role: "button", name: "Danger" } },
      { action: "click", locator: { kind: "role", role: "button", name: "Inside frame", frame: 'iframe[title="embedded"]' } },
      { action: "press", locator: { kind: "role", role: "button", name: "Inside frame", frame: 'iframe[title="embedded"]' }, key: "Enter" },
    ])
    expect(warnings).toEqual([])
  })

  it("turns the focusing click into the fill instead of adding a step", () => {
    const { sent } = replay(NO_VALUES)
    const emailSteps = sent.filter((step) => JSON.stringify(step.config).includes('"Email"'))
    expect(new Set(emailSteps.map((step) => step.stepId)).size).toBe(1)
    expect(emailSteps[0]?.config.action).toBe("click")
    expect(emailSteps.at(-1)?.config).toMatchObject({ action: "fill", value: "me@example.com" })
  })

  it("never sends any part of a password that matches no secret", () => {
    const { sent, steps } = replay(NO_VALUES)
    const json = JSON.stringify(sent)
    for (const fragment of ["hunter22", "hunt", '"h"', '"hu"']) expect(json).not.toContain(fragment)
    expect([...steps.values()][2]).toEqual({
      action: "fill",
      locator: { kind: "role", role: "textbox", name: "Password" },
      value: "{{secrets.UNSET_PASSWORD_1}}",
    })
  })

  it("keeps the literal email and URL when no variable holds them", () => {
    const { steps } = replay(NO_VALUES)
    const values = [...steps.values()]
    expect(values[0]).toEqual({ action: "navigate", url: `${BASE}/` })
    expect(values[1]).toMatchObject({ value: "me@example.com" })
  })
})

describe("RecordingConverter rules", () => {
  const fill = (text: string, kind: RecorderEvent["kind"] = "updated", isPassword = false): RecorderEvent => ({
    kind,
    action: { name: "fill", selector: 'internal:role=textbox[name="Token"i]', text },
    onMainPage: true,
    isPassword,
  })

  it("holds back a typed value while it ends in the start of a secret", () => {
    const recording = converter({ env: {}, secrets: { API_KEY: "sk-live-abcdef" } })
    const sent = ["B", "Bearer ", "Bearer sk-l", "Bearer sk-live-ab", "Bearer sk-live-abcdef"].flatMap(
      (text, index) => recording.apply(fill(text, index === 0 ? "added" : "updated")).steps,
    )
    expect(sent.map((step) => step.config)).toEqual([
      expect.objectContaining({ value: "B" }),
      expect.objectContaining({ value: "Bearer " }),
      expect.objectContaining({ value: "Bearer {{secrets.API_KEY}}" }),
    ])
    expect(JSON.stringify(sent)).not.toContain("sk-l")
  })

  it("gives a value still held back when the recording ends a placeholder secret", () => {
    const recording = converter({ env: {}, secrets: { API_KEY: "sk-live-abcdef" } })
    recording.apply(fill("sk-live", "added"))
    expect(recording.finish().steps).toEqual([
      { stepId: "step-1", config: expect.objectContaining({ action: "fill", value: "{{secrets.UNSET_SECRET_1}}" }) },
    ])
  })

  it("never names a placeholder after a secret in scope or one the workflow already uses", () => {
    const recording = converter({ env: {}, secrets: { UNSET_PASSWORD_1: "other" } }, new Set(["UNSET_PASSWORD_2"]))
    const [step] = recording.apply(fill("typed", "added", true)).steps
    expect(step?.config).toMatchObject({ value: "{{secrets.UNSET_PASSWORD_3}}" })
  })

  it("keeps a password step's placeholder name across keystrokes", () => {
    const recording = converter()
    const first = recording.apply(fill("a", "added", true)).steps
    const later = recording.apply(fill("abcdef", "updated", true)).steps
    expect(first[0]?.config).toMatchObject({ value: "{{secrets.UNSET_PASSWORD_1}}" })
    // Same config again: nothing to send.
    expect(later).toEqual([])
  })

  it("drops a click with clickCount 0 and records modifiers, button and double clicks", () => {
    const recording = converter()
    const click = (extra: Record<string, unknown>): RecordedBrowserStep[] =>
      recording.apply({ kind: "added", action: { name: "click", selector: "#row", ...extra }, onMainPage: true }).steps
    expect(click({ clickCount: 0 })).toEqual([])
    expect(click({ clickCount: 2, button: "left", modifiers: 2 | 8 })[0]?.config).toEqual({
      action: "click",
      locator: { kind: "css", value: "#row" },
      clickCount: 2,
      modifiers: ["ControlOrMeta", "Shift"],
    })
    expect(click({ button: "right", clickCount: 1, modifiers: 0 })[0]?.config).toEqual({
      action: "click",
      locator: { kind: "css", value: "#row" },
      button: "right",
    })
  })

  it("turns a key press with modifiers into a chord, with or without an element", () => {
    const recording = converter()
    const [step] = recording.apply({ kind: "added", action: { name: "press", key: "a", modifiers: 2 }, onMainPage: true }).steps
    expect(step?.config).toEqual({ action: "press", key: "ControlOrMeta+a" })
  })

  it("warns once about popups, and records nothing done in them", () => {
    const recording = converter()
    expect(recording.apply({ kind: "added", action: { name: "openPage", url: "about:blank" }, onMainPage: true }).warnings).toEqual([])
    const popup = recording.apply({ kind: "added", action: { name: "openPage", url: "about:blank" }, onMainPage: true })
    expect(popup.warnings).toHaveLength(1)
    const inPopup = recording.apply({ kind: "added", action: { name: "click", selector: "#x" }, onMainPage: false })
    expect(inPopup).toEqual({ steps: [], warnings: [] })
  })

  it("warns once about checks it has no step for, and about file uploads", () => {
    const recording = converter()
    const add = (name: string): string[] =>
      [...recording.apply({ kind: "added", action: { name, selector: "#x" }, onMainPage: true }).warnings]
    expect(add("assertChecked")).toHaveLength(1)
    expect(add("assertSnapshot")).toEqual([])
    expect(add("setInputFiles")).toHaveLength(1)
  })

  it("does not record a step whose locator shows a secret, or an address that contains one", () => {
    const recording = converter({ env: {}, secrets: { TOKEN: "tok-123456" } })
    const click = recording.apply({ kind: "added", action: { name: "click", selector: 'internal:text="Key tok-123456"i' }, onMainPage: true })
    const navigate = recording.apply({ kind: "added", action: { name: "navigate", url: "https://app.test/?t=tok-123456" }, onMainPage: true })
    expect([...click.steps, ...navigate.steps]).toEqual([])
    expect(click.warnings).toHaveLength(1)
    expect(navigate.warnings).toHaveLength(1)
  })

  it("does not record a step whose locator shows the start of a secret, as Playwright shortens names to a unique prefix", () => {
    const recording = converter({ env: {}, secrets: { TOKEN: "tok-123456" } })
    const click = (selector: string): RecordedBrowserStep[] =>
      [...recording.apply({ kind: "added", action: { name: "click", selector }, onMainPage: true }).steps]
    expect(click('internal:role=button[name="Key tok-"i]')).toEqual([])
    // Inside a raw selector the shortened name ends at its quote, not at the end of the selector.
    expect(click('#keys >> internal:has-text="Key tok-1"i >> nth=1')).toEqual([])
    // Three characters of it are not enough to count, as for typed text.
    expect(click('internal:role=button[name="Key tok"i]')).toHaveLength(1)
  })

  it("does not record a step whose locator shows a secret that holds a quote or a backslash", () => {
    const values: RecordingValues = { env: {}, secrets: { ODD: 'pa"ss\\word1' } }
    // A role's name and a plain CSS value: JSON escaping and the selector's own
    // escaping both hide the secret from a check on the serialized config.
    const selectors = ['internal:role=button[name="pa\\"ss\\\\word1"i]', 'css=div[title="pa\\"ss\\\\word1"]']
    for (const selector of selectors) {
      const output = converter(values).apply({ kind: "added", action: { name: "click", selector }, onMainPage: true })
      expect(output.steps).toEqual([])
      expect(output.warnings).toEqual(["A step was not recorded because it contained a secret value."])
    }
  })

  it("does not give a placeholder to a held-back fill whose locator shows a secret", () => {
    const recording = converter({ env: {}, secrets: { API_KEY: "sk-live-abcdef", ODD: 'pa"ss\\word1' } })
    const selector = 'internal:role=textbox[name="pa\\"ss\\\\word1"i]'
    expect(recording.apply({ kind: "added", action: { name: "fill", selector, text: "sk-live" }, onMainPage: true }).steps).toEqual([])
    expect(recording.finish().steps).toEqual([])
  })

  it("reads only the fields it uses from a raw payload", () => {
    expect(
      readRecorderAction({ name: "fill", selector: "#pw", text: "x", ref: "e5", ariaSnapshot: '- textbox "Password": x', signals: [] }),
    ).toEqual({ name: "fill", selector: "#pw", text: "x" })
    expect(readRecorderAction({ selector: "#x" })).toBeNull()
  })
})

describe("RecordingConverter checks from the recorder toolbar", () => {
  const values: RecordingValues = {
    env: { TEST_EMAIL: "ada@acme.test", PAGE_SIZE: "10" },
    secrets: { TEST_PASSWORD: "fixture-pass-2468", PIN: "12" },
  }
  const heading = 'internal:role=heading[name="Dashboard"i]'
  const check = (action: RecorderEvent["action"], isPassword = false): ReturnType<RecordingConverter["apply"]> =>
    converter(values).apply({ kind: "added", action, onMainPage: true, isPassword })

  it("turns visibility, text and value checks into expect steps", () => {
    const locator = { kind: "role", role: "heading", name: "Dashboard" }
    expect(check({ name: "assertVisible", selector: heading }).steps[0]?.config).toEqual({ action: "expect-visible", locator })
    expect(check({ name: "assertText", selector: heading, text: "Dashboard", substring: true }).steps[0]?.config).toEqual({
      action: "expect-text",
      locator,
      text: "Dashboard",
      match: "contains",
    })
    expect(check({ name: "assertText", selector: heading, text: "Dashboard", substring: false }).steps[0]?.config).toMatchObject({
      match: "equals",
    })
    expect(check({ name: "assertValue", selector: "#q", value: "" }).steps[0]?.config).toEqual({
      action: "expect-value",
      locator: { kind: "css", value: "#q" },
      value: "",
    })
  })

  it("writes an expected text equal to an environment variable as its template, and leaves short ones literal", () => {
    expect(check({ name: "assertText", selector: heading, text: "ada@acme.test", substring: true }).steps[0]?.config).toMatchObject({
      text: "{{env.TEST_EMAIL}}",
    })
    expect(check({ name: "assertValue", selector: "#n", value: "10" }).steps[0]?.config).toMatchObject({ value: "10" })
  })

  it.each([
    ["is a secret", { name: "assertText", selector: heading, text: "fixture-pass-2468" }],
    ["is a short secret", { name: "assertValue", selector: "#pin", value: "12" }],
    ["contains a secret", { name: "assertText", selector: heading, text: "Your key: fixture-pass-2468", substring: true }],
  ])("does not record a check whose expected text %s", (_why, action) => {
    const output = check(action)
    expect(output.steps).toEqual([])
    expect(output.warnings).toEqual(["A step was not recorded because it contained a secret value."])
  })

  it("does not record a value check on a password field", () => {
    const output = check({ name: "assertValue", selector: "#pw", value: "hunter22" }, true)
    expect(output.steps).toEqual([])
    expect(JSON.stringify(output)).not.toContain("hunter22")
    expect(output.warnings).toEqual(["A check on a password field was not recorded: it would have stored the password."])
  })

  it("reads a check's value and substring flag from a raw payload", () => {
    expect(readRecorderAction({ name: "assertText", selector: "#m", text: "Hi", substring: true, ariaSnapshot: "x" })).toEqual({
      name: "assertText",
      selector: "#m",
      text: "Hi",
      substring: true,
    })
    expect(readRecorderAction({ name: "assertValue", selector: "#q", value: "abc" })).toEqual({ name: "assertValue", selector: "#q", value: "abc" })
  })
})

describe("RecordingConverter dialogs", () => {
  const button = 'internal:role=button[name="Delete"i]'

  it("sets the click that opened a dialog to click OK, and says so once", () => {
    const recording = converter()
    const [click] = recording.apply({ kind: "added", action: { name: "click", selector: button, button: "left", clickCount: 1 }, onMainPage: true }).steps
    const first = recording.signal("dialog", true, true)
    expect(first.steps).toEqual([
      { stepId: click?.stepId, config: { action: "click", locator: { kind: "role", role: "button", name: "Delete" }, dialog: "accept" } },
    ])
    expect(first.warnings).toHaveLength(1)
    // A second dialog after the same step changes nothing and says nothing new.
    expect(recording.signal("dialog", true, true)).toEqual({ steps: [], warnings: [] })
  })

  it("sets a key press that opened a dialog to click OK", () => {
    const recording = converter()
    recording.apply({ kind: "added", action: { name: "press", selector: button, key: "Enter", modifiers: 0 }, onMainPage: true })
    expect(recording.signal("dialog", true, true).steps[0]?.config).toMatchObject({ action: "press", key: "Enter", dialog: "accept" })
  })

  it("leaves a step alone when the dialog arrived long after it", () => {
    const recording = converter()
    const [click] = recording.apply({ kind: "added", action: { name: "click", selector: button }, onMainPage: true }).steps
    const late = recording.signal("dialog", true, false)
    expect(late.steps).toEqual([])
    expect(late.warnings).toEqual([
      "The page showed a dialog a while after the last step, or after a step that cannot answer one. When the workflow runs, that dialog is cancelled.",
    ])
    // The step still has no dialog field, so a run cancels that dialog.
    expect(click?.config).toEqual({ action: "click", locator: { kind: "role", role: "button", name: "Delete" } })
  })

  it("warns when a dialog follows a step that cannot answer one, or no step at all", () => {
    const recording = converter()
    expect(recording.signal("dialog", true, true).warnings).toHaveLength(1)
    recording.apply({ kind: "added", action: { name: "navigate", url: "https://app.test/" }, onMainPage: true })
    // Once per recording.
    expect(recording.signal("dialog", true, true)).toEqual({ steps: [], warnings: [] })
  })

  it("ignores other signals, and dialogs in a popup", () => {
    const recording = converter()
    recording.apply({ kind: "added", action: { name: "click", selector: button }, onMainPage: true })
    expect(recording.signal("download", true, true)).toEqual({ steps: [], warnings: [] })
    expect(recording.signal("dialog", false, true)).toEqual({ steps: [], warnings: [] })
  })

  it("reads only a signal's name", () => {
    expect(readRecorderSignal({ name: "dialog", dialogAlias: "" })).toBe("dialog")
    expect(readRecorderSignal({ dialogAlias: "" })).toBeNull()
  })
})

describe("templateCheck", () => {
  const values: RecordingValues = { env: { TEST_EMAIL: "ada@acme.test", SHORT: "ab" }, secrets: { TOKEN: "tok-123456", PIN: "12" } }

  it.each([
    ["ada@acme.test", "{{env.TEST_EMAIL}}"],
    ["ab", "ab"],
    ["Welcome ada@acme.test", "Welcome ada@acme.test"],
    ["order 12", "order 12"],
    ["", ""],
  ])("%j → %j", (text, expected) => {
    expect(templateCheck(text, values)).toBe(expected)
  })

  it.each(["tok-123456", "12", "key tok-123456"])("refuses %j", (text) => {
    expect(templateCheck(text, values)).toBeNull()
  })
})

describe("templateFill", () => {
  const values: RecordingValues = {
    env: { TEST_EMAIL: "ada@acme.test", SHORT: "ab" },
    secrets: { TEST_PASSWORD: "fixture-pass-2468", PIN: "12" },
  }

  it.each([
    ["ada@acme.test", false, "{{env.TEST_EMAIL}}"],
    ["fixture-pass-2468", false, "{{secrets.TEST_PASSWORD}}"],
    ["fixture-pass-2468", true, "{{secrets.TEST_PASSWORD}}"],
    // A short secret is still matched when it is the whole value…
    ["12", false, "{{secrets.PIN}}"],
    // …but never replaced inside other text, the way a run never masks it.
    ["order 12", false, "order 12"],
    ["pass: fixture-pass-2468!", false, "pass: {{secrets.TEST_PASSWORD}}!"],
    ["", true, ""],
    ["hello", false, "hello"],
  ])("%j (password %s) → %j", (text, password, expected) => {
    expect(templateFill(text, values, password)).toEqual({ kind: "value", value: expected })
  })

  it("marks a password that is no secret as unset, and a secret's start as withheld", () => {
    expect(templateFill("hunter22", values, true)).toEqual({ kind: "unset" })
    expect(templateFill("fixture-p", values, false)).toEqual({ kind: "withheld" })
    // Three characters is below what a run masks: sent as typed.
    expect(templateFill("fix", values, false)).toEqual({ kind: "value", value: "fix" })
  })
})

describe("templateUrl", () => {
  const values: RecordingValues = {
    env: { BASE_URL: "http://127.0.0.1:4777", API_URL: "http://127.0.0.1:4777/api", NAME: "http" },
    secrets: { TOKEN: "tok-123456" },
  }

  it.each([
    ["http://127.0.0.1:4777/login", "{{env.BASE_URL}}/login"],
    ["http://127.0.0.1:4777", "{{env.BASE_URL}}"],
    ["http://127.0.0.1:4777/api/users", "{{env.API_URL}}/users"],
    ["http://127.0.0.1:47770/", "http://127.0.0.1:47770/"],
    ["https://elsewhere.test/", "https://elsewhere.test/"],
  ])("%s → %s", (url, expected) => {
    expect(templateUrl(url, values)).toBe(expected)
  })

  it("refuses an address that contains a secret", () => {
    expect(templateUrl("http://127.0.0.1:4777/?t=tok-123456", values)).toBeNull()
  })
})
