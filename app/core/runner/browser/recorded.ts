import type { BrowserLocator } from "@shared/types/BrowserLocator"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep"
import { BrowserNodeDataSchema } from "@shared/zod-schemas/BrowserNodeDataSchema"
import { parseRecordedSelector } from "./selector_parse"
import { containsSecret, showsSecret, templateCheck, templateFill, templateUrl, type RecordingValues } from "./recording_values"

/**
 * The fields of a Playwright recorder action this converter reads. Playwright
 * sends more — `ariaSnapshot` holds the whole page with every typed value, the
 * password included — and {@link readRecorderAction} drops all of it at the
 * boundary.
 */
export interface RecorderAction {
  readonly name: string
  readonly selector?: string
  readonly url?: string
  readonly text?: string
  readonly options?: readonly string[]
  readonly key?: string
  readonly modifiers?: number
  readonly button?: string
  readonly clickCount?: number
  /** `assertValue`: the field value the user checked. */
  readonly value?: string
  /** `assertText`: true for "contains", false for the whole text. */
  readonly substring?: boolean
}

/** One recorder event, as the recording hands it over. */
export interface RecorderEvent {
  readonly kind: "added" | "updated"
  readonly action: RecorderAction
  /** False for a popup or a second tab: the runner drives one page only. */
  readonly onMainPage: boolean
  /** For a fill or a value check: whether the field is an `<input type="password">`. Asked of the page by the recording. */
  readonly isPassword?: boolean
}

/** The recorder actions whose field the recording asks the page about: is it a password? */
export function readsField(action: RecorderAction): boolean {
  return action.name === "fill" || action.name === "assertValue"
}

/** What one event changed: steps to insert or replace, in order, and messages for the user. */
export interface ConverterOutput {
  readonly steps: readonly RecordedBrowserStep[]
  readonly warnings: readonly string[]
}

/** Copy the fields the converter reads out of a raw recorder payload, and nothing else. */
export function readRecorderAction(raw: unknown): RecorderAction | null {
  if (typeof raw !== "object" || raw === null) return null
  const record = raw as Record<string, unknown>
  const name = record["name"]
  if (typeof name !== "string") return null
  const text = (key: string): string | undefined => {
    const value = record[key]
    return typeof value === "string" ? value : undefined
  }
  const count = (key: string): number | undefined => {
    const value = record[key]
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }
  const options = record["options"]
  const action: { -readonly [K in keyof RecorderAction]: RecorderAction[K] } = { name }
  const fields = {
    selector: text("selector"),
    url: text("url"),
    text: text("text"),
    key: text("key"),
    button: text("button"),
    value: text("value"),
  }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) action[key as keyof typeof fields] = value
  const modifiers = count("modifiers")
  if (modifiers !== undefined) action.modifiers = modifiers
  const clickCount = count("clickCount")
  if (clickCount !== undefined) action.clickCount = clickCount
  if (typeof record["substring"] === "boolean") action.substring = record["substring"]
  if (Array.isArray(options)) action.options = options.filter((option): option is string => typeof option === "string")
  return action
}

/** The name of a recorder signal (`dialog`, `popup`, `download`…), and nothing else from it. */
export function readRecorderSignal(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null
  const name = (raw as Record<string, unknown>)["name"]
  return typeof name === "string" ? name : null
}

/** Playwright's modifier bitmask, the way its own code generator reads it: Control and Meta are both `ControlOrMeta`. */
function modifierKeys(mask: number | undefined): Array<"Alt" | "ControlOrMeta" | "Shift"> {
  const keys: Array<"Alt" | "ControlOrMeta" | "Shift"> = []
  if (mask === undefined) return keys
  if (mask & 1) keys.push("Alt")
  if (mask & 6) keys.push("ControlOrMeta")
  if (mask & 8) keys.push("Shift")
  return keys
}

/** Messages shown once per recording for what it cannot turn into a step. */
const WARNINGS = {
  popup: "The page opened a popup or a new tab. Browser steps drive one page, so nothing done there was recorded.",
  check: "Checks of a checkbox's state and of an ARIA snapshot are not supported by browser steps yet, so this one was not recorded. Use a visibility, text or value check instead.",
  passwordCheck: "A check on a password field was not recorded: it would have stored the password.",
  dialog:
    "The page showed a dialog (alert, confirm or prompt). The recording clicked OK, and the step that opened it is set to do the same when it runs. To cancel instead, open that step and choose Click Cancel.",
  dialogElsewhere:
    "The page showed a dialog a while after the last step, or after a step that cannot answer one. When the workflow runs, that dialog is cancelled.",
  upload: "File uploads are not supported by browser steps yet, so this one was not recorded.",
  element: "A step was not recorded: the element it used could not be described.",
  secretUrl: "A page address contained a secret value, so it was not recorded.",
  secretStep: "A step was not recorded because it contained a secret value.",
} as const

type Converted =
  | { readonly kind: "config"; readonly config: BrowserNodeData }
  | { readonly kind: "withheld" }
  | { readonly kind: "skip"; readonly warning?: keyof typeof WARNINGS }

/** What a config that has been checked comes to: it is sent, or there is a reason it is not. */
type CheckedResult = Exclude<Converted, { readonly kind: "withheld" }>

/**
 * Every string a config holds, walked as values: `JSON.stringify` escapes `"`
 * and `\`, so a secret holding either would not appear in the serialized form.
 */
function configStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value as unknown[]) configStrings(item, into)
  } else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value as Record<string, unknown>)) configStrings(item, into)
  }
  return into
}

/**
 * Whether a selector Playwright wrote shows a secret or the start of one: the
 * whole selector as written and with its backslash escapes undone
 * (`pa\"ss\\word1` is `pa"ss\word1`) since a `{ kind: "selector" }` locator
 * keeps them, and each quoted name in it on its own. Only a quoted name is
 * shortened by Playwright to a unique prefix — which is why a shortened name
 * ends at its closing quote rather than at the end of the selector — so the
 * prefix rule applies to quoted names alone. Judging the whole selector by it
 * refused nameless ones such as `internal:role=link` whenever a secret begins
 * `link`; a whole secret in the selector is still caught.
 */
export function selectorShowsSecret(selector: string, values: RecordingValues): boolean {
  const unescape = (text: string): string => text.replace(/\\(.)/gs, "$1")
  const quoted = [...selector.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => unescape(match[1] ?? ""))
  return containsSecret(selector, values) || containsSecret(unescape(selector), values) || quoted.some((name) => showsSecret(name, values))
}

/**
 * The locator keys that hold no page text: the `kind` discriminator, an ARIA
 * `role` name, the `exact` match switch and the `nth` index. The prefix rule
 * must not judge them: a secret that begins `role`, `text` or `link` is a
 * secret that begins most of a page, and refusing every locator of that kind
 * or role would make the page unpickable. A whole secret in them is still
 * caught, because {@link checked} walks the whole config with
 * {@link containsSecret}.
 */
const STRUCTURAL_LOCATOR_KEYS: ReadonlySet<string> = new Set(["kind", "role", "exact", "nth"])

/**
 * Every string a locator takes from the page — a name, a label, a placeholder,
 * a test id, a `hasText`, a CSS or raw selector value — and the same fields of
 * a nested `within` locator, which is the only object one holds. Only this text
 * can end in the start of a secret, since Playwright shortens an element's name
 * to a unique prefix.
 */
function locatorPageText(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value)
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (!STRUCTURAL_LOCATOR_KEYS.has(key)) locatorPageText(child, into)
    }
  }
  return into
}

/** Whether a locator's page text shows a secret or the start of one. */
function locatorShowsSecret(locator: BrowserLocator, values: RecordingValues): boolean {
  return locatorPageText(locator).some((text) => showsSecret(text, values))
}

/** What an element the user picked becomes: its locator, or why it cannot have one. */
export type PickedLocator =
  | { readonly kind: "locator"; readonly locator: BrowserLocator }
  /** The element's text or attributes show a secret, or its start: storing the locator would store it. */
  | { readonly kind: "secret" }
  /** Playwright described the element in a way no locator can hold. */
  | { readonly kind: "undescribable" }

/** The locator for a selector from `page.pickLocator()`, checked like a recorded step's. */
export function locatorFromSelector(selector: string, values: RecordingValues): PickedLocator {
  const locator = parseRecordedSelector(selector)
  if (locator === null) return { kind: "undescribable" }
  if (selectorShowsSecret(selector, values) || locatorShowsSecret(locator, values)) return { kind: "secret" }
  return { kind: "locator", locator }
}

/** `dialog: "accept"` for a click or key press after which the recording answered a dialog with OK. */
function dialogField(state: StepState): { dialog?: "accept" } {
  return state.acceptsDialog === true ? { dialog: "accept" } : {}
}

/** One step the recording has produced. */
interface StepState {
  readonly stepId: string
  action: RecorderAction
  isPassword: boolean
  /** The placeholder secret this step was given, kept so its updates keep the same name. */
  unsetSecret?: string
  /** The last update was held back because it ended in the start of a secret. */
  withheld: boolean
  /** The page showed a dialog after this click or key press, and the recording clicked OK. */
  acceptsDialog?: true
  /** The config last sent, so an update that changes nothing sends nothing. */
  sent?: string
}

/**
 * Turns Playwright recorder events into browser steps, one event at a time,
 * so the canvas can show each step as the user records it.
 *
 * Events arrive live, which shapes the rules from the Phase 0 recording:
 * - A fill arrives as one `added` and then one `updated` per keystroke; each
 *   update replaces the same step.
 * - Clicking into a field comes as a `click` just before its `fill`. The click
 *   has already been sent, so the fill takes over its step instead of dropping it.
 * - A `click` with `clickCount: 0` (after a key press) is noise and is dropped.
 * - `openPage` and `closePage` produce no step; a second page is a popup.
 * - The toolbar's checks arrive as `assertVisible`, `assertText` and
 *   `assertValue`, and become `expect-*` steps.
 * - A `dialog` signal follows the action that opened the dialog, at once (see
 *   {@link signal}).
 *
 * Every value goes through {@link templateFill} or {@link templateUrl} before
 * it is returned, and a step whose config — or the selector it came from —
 * would still contain a secret is dropped: what this returns may be sent to
 * the renderer as it is.
 */
export class RecordingConverter {
  private readonly steps: StepState[] = []
  /** The step the last recorder action became, which an `updated` event replaces. Null when it became none. */
  private current: StepState | null = null
  private sawFirstPage: boolean
  private readonly warned = new Set<keyof typeof WARNINGS>()
  private unsetCount = 0

  public constructor(
    private readonly values: RecordingValues,
    private readonly newStepId: () => string,
    /** Secret names the workflow already uses: a placeholder never takes one, set or not. */
    private readonly takenSecretNames: ReadonlySet<string> = new Set(),
    /**
     * The recording joins a page that is already open (re-recording after a
     * replay), so Playwright sends no `openPage` for it and the first one it
     * does send is a popup.
     */
    pageAlreadyOpen = false,
  ) {
    this.sawFirstPage = pageAlreadyOpen
  }

  /** Apply one recorder event. */
  public apply(event: RecorderEvent): ConverterOutput {
    const warnings: string[] = []
    if (!event.onMainPage) {
      this.current = null
      this.warn("popup", warnings)
      return { steps: [], warnings }
    }
    const state = event.kind === "updated" && this.current !== null ? this.current : this.place(event.action, warnings)
    if (state === null) return { steps: [], warnings }
    state.action = event.action
    state.isPassword ||= event.isPassword === true
    return { steps: this.emit(state, warnings), warnings }
  }

  /**
   * Apply one recorder signal. Only `dialog` changes a step: Playwright sends
   * it right after the action that opened the dialog, which the recording
   * answered with OK, so that click or key press is set to do the same.
   *
   * A dialog that arrives later than that (`isRecent` false) was opened by a
   * timer or by the page itself, not by the step before it, so no step claims
   * it and the warning says the run will cancel it.
   */
  public signal(name: string, onMainPage: boolean, isRecent: boolean): ConverterOutput {
    const warnings: string[] = []
    if (name !== "dialog" || !onMainPage) return { steps: [], warnings }
    const state = this.current
    const opener = state?.action.name
    if (!isRecent || state === null || state.sent === undefined || (opener !== "click" && opener !== "press")) {
      this.warn("dialogElsewhere", warnings)
      return { steps: [], warnings }
    }
    this.warn("dialog", warnings)
    state.acceptsDialog = true
    return { steps: this.emit(state, warnings), warnings }
  }

  /**
   * End the recording: a step still held back because it ended in the start
   * of a secret becomes a placeholder secret, so the partial value is never
   * sent. Its locator was never checked while it was held back, so the step is
   * checked here too and dropped if the element's own text shows a secret.
   */
  public finish(): ConverterOutput {
    const steps: RecordedBrowserStep[] = []
    const warnings: string[] = []
    for (const state of this.steps) {
      if (!state.withheld || state.action.selector === undefined) continue
      const locator = parseRecordedSelector(state.action.selector)
      if (locator === null) continue
      state.withheld = false
      const unsetSecret = state.unsetSecret ?? this.nextUnsetSecret("UNSET_SECRET")
      const converted = this.checked({ action: "fill", locator, value: `{{secrets.${unsetSecret}}}` }, state.action)
      if (converted.kind === "skip") {
        if (converted.warning !== undefined) this.warn(converted.warning, warnings)
        continue
      }
      state.unsetSecret = unsetSecret
      state.sent = JSON.stringify(converted.config)
      steps.push({ stepId: state.stepId, config: converted.config })
    }
    return { steps, warnings }
  }

  /** The step a newly added action becomes, or null when it becomes none. */
  private place(action: RecorderAction, warnings: string[]): StepState | null {
    this.current = null
    if (action.name === "openPage") {
      if (this.sawFirstPage) this.warn("popup", warnings)
      this.sawFirstPage = true
      return null
    }
    if (action.name === "closePage" || (action.name === "click" && action.clickCount === 0)) return null
    const last = this.steps.at(-1)
    if (action.name === "fill" && last !== undefined && last.action.name === "click" && last.action.selector === action.selector) {
      this.current = last
      return last
    }
    const state: StepState = { stepId: this.newStepId(), action, isPassword: false, withheld: false }
    this.current = state
    return state
  }

  /** Convert `state` and return it as a step, unless it is unchanged, held back or skipped. */
  private emit(state: StepState, warnings: string[]): RecordedBrowserStep[] {
    const converted = this.convert(state)
    if (converted.kind === "skip") {
      if (converted.warning !== undefined) this.warn(converted.warning, warnings)
      // A step already on the canvas stays as it was; a new one never appears.
      if (this.current === state && state.sent === undefined) this.current = null
      return []
    }
    if (!this.steps.includes(state)) this.steps.push(state)
    if (converted.kind === "withheld") {
      state.withheld = true
      return []
    }
    state.withheld = false
    const serialized = JSON.stringify(converted.config)
    if (serialized === state.sent) return []
    state.sent = serialized
    return [{ stepId: state.stepId, config: converted.config }]
  }

  private convert(state: StepState): Converted {
    const { action } = state
    if (action.name === "navigate") {
      if (action.url === undefined) return { kind: "skip" }
      const url = templateUrl(action.url, this.values)
      return url === null ? { kind: "skip", warning: "secretUrl" } : this.checked({ action: "navigate", url }, action)
    }
    if (action.name === "setInputFiles") return { kind: "skip", warning: "upload" }
    const locator = action.selector === undefined ? undefined : parseRecordedSelector(action.selector)
    if (locator === null) return { kind: "skip", warning: "element" }
    if (action.name === "press") {
      if (action.key === undefined) return { kind: "skip" }
      const key = [...modifierKeys(action.modifiers), action.key].join("+")
      const config: BrowserNodeData = { action: "press", key, ...(locator === undefined ? {} : { locator }), ...dialogField(state) }
      return this.checked(config, action)
    }
    if (locator === undefined) return { kind: "skip" }
    if (action.name.startsWith("assert")) return this.convertCheck(state, locator)
    return this.convertOnElement(state, locator)
  }

  /**
   * A check made with the recorder toolbar's assert buttons. The expected text
   * goes through {@link templateCheck}: a check cannot hold `{{secrets.*}}`,
   * so one that would show a secret, or the value of a password field, is not
   * recorded.
   */
  private convertCheck(state: StepState, locator: BrowserLocator): CheckedResult {
    const { action } = state
    switch (action.name) {
      case "assertVisible":
        return this.checked({ action: "expect-visible", locator }, action)
      case "assertText": {
        const text = templateCheck(action.text ?? "", this.values)
        if (text === null) return { kind: "skip", warning: "secretStep" }
        return this.checked({ action: "expect-text", locator, text, match: action.substring === false ? "equals" : "contains" }, action)
      }
      case "assertValue": {
        if (state.isPassword) return { kind: "skip", warning: "passwordCheck" }
        const value = templateCheck(action.value ?? "", this.values)
        if (value === null) return { kind: "skip", warning: "secretStep" }
        return this.checked({ action: "expect-value", locator, value }, action)
      }
      default:
        // assertChecked has no browser step yet, and assertSnapshot holds a whole ARIA snapshot.
        return { kind: "skip", warning: "check" }
    }
  }

  private convertOnElement(state: StepState, locator: BrowserLocator): Converted {
    const { action } = state
    switch (action.name) {
      case "click": {
        const modifiers = modifierKeys(action.modifiers)
        const clickCount = Math.min(action.clickCount ?? 1, 3)
        const button = action.button === "right" || action.button === "middle" ? action.button : undefined
        const config: BrowserNodeData = {
          action: "click",
          locator,
          ...(button === undefined ? {} : { button }),
          ...(clickCount > 1 ? { clickCount } : {}),
          ...(modifiers.length > 0 ? { modifiers } : {}),
          ...dialogField(state),
        }
        return this.checked(config, action)
      }
      case "fill":
        return this.convertFill(state, locator)
      case "check":
      case "uncheck":
      case "hover":
        return this.checked({ action: action.name, locator }, action)
      case "select":
        return action.options === undefined || action.options.length === 0
          ? { kind: "skip" }
          : this.checked({ action: "select", locator, values: [...action.options] }, action)
      default:
        return { kind: "skip" }
    }
  }

  private convertFill(state: StepState, locator: BrowserLocator): Converted {
    const templated = templateFill(state.action.text ?? "", this.values, state.isPassword)
    if (templated.kind === "withheld") return templated
    if (templated.kind === "unset") state.unsetSecret ??= this.nextUnsetSecret("UNSET_PASSWORD")
    const value = templated.kind === "unset" ? `{{secrets.${state.unsetSecret}}}` : templated.value
    return this.checked({ action: "fill", locator, value }, state.action)
  }

  /**
   * The config, if it is valid and carries no secret anywhere: a whole secret
   * anywhere in it refuses the step, a locator's page text also refuses it when
   * it ends in the start of one, and the selector it came from is checked both
   * as written and with its escapes undone, since a `{ kind: "selector" }`
   * locator keeps them.
   */
  private checked(config: BrowserNodeData, action: RecorderAction): CheckedResult {
    const showsSecret =
      configStrings(config).some((text) => containsSecret(text, this.values)) ||
      ("locator" in config && config.locator !== undefined && locatorShowsSecret(config.locator, this.values)) ||
      (action.selector !== undefined && selectorShowsSecret(action.selector, this.values))
    if (showsSecret) return { kind: "skip", warning: "secretStep" }
    return BrowserNodeDataSchema.safeParse(config).success ? { kind: "config", config } : { kind: "skip", warning: "element" }
  }

  /**
   * A placeholder secret name that no secret in scope and no step of the
   * workflow already uses, so it can never resolve to another value.
   */
  private nextUnsetSecret(prefix: string): string {
    let name: string
    do {
      this.unsetCount++
      name = `${prefix}_${this.unsetCount}`
    } while (Object.hasOwn(this.values.secrets, name) || this.takenSecretNames.has(name))
    return name
  }

  private warn(kind: keyof typeof WARNINGS, warnings: string[]): void {
    if (this.warned.has(kind)) return
    this.warned.add(kind)
    warnings.push(WARNINGS[kind])
  }
}
