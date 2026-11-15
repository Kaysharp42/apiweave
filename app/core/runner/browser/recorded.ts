import type { BrowserLocator } from "@shared/types/BrowserLocator"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import { BrowserNodeDataSchema } from "@shared/zod-schemas/BrowserNodeDataSchema"
import { parseRecordedSelector } from "./selector_parse"
import { containsSecret, templateFill, templateUrl, type RecordingValues } from "./recording_values"

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
}

/** One recorder event, as the recording hands it over. */
export interface RecorderEvent {
  readonly kind: "added" | "updated"
  readonly action: RecorderAction
  /** False for a popup or a second tab: the runner drives one page only. */
  readonly onMainPage: boolean
  /** For a fill: whether the field is an `<input type="password">`. Asked of the page by the recording. */
  readonly isPassword?: boolean
}

/** A step as the canvas receives it: the same `stepId` again replaces that step's config. */
export interface RecordedStep {
  readonly stepId: string
  readonly config: BrowserNodeData
}

/** What one event changed: steps to insert or replace, in order, and messages for the user. */
export interface ConverterOutput {
  readonly steps: readonly RecordedStep[]
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
  const fields = { selector: text("selector"), url: text("url"), text: text("text"), key: text("key"), button: text("button") }
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) action[key as keyof typeof fields] = value
  const modifiers = count("modifiers")
  if (modifiers !== undefined) action.modifiers = modifiers
  const clickCount = count("clickCount")
  if (clickCount !== undefined) action.clickCount = clickCount
  if (Array.isArray(options)) action.options = options.filter((option): option is string => typeof option === "string")
  return action
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
  check: "Checks from the recorder toolbar are not recorded yet. Add an expect step to the workflow instead.",
  upload: "File uploads are not supported by browser steps yet, so this one was not recorded.",
  element: "A step was not recorded: the element it used could not be described.",
  secretUrl: "A page address contained a secret value, so it was not recorded.",
  secretStep: "A step was not recorded because it contained a secret value.",
} as const

type Converted =
  | { readonly kind: "config"; readonly config: BrowserNodeData }
  | { readonly kind: "withheld" }
  | { readonly kind: "skip"; readonly warning?: keyof typeof WARNINGS }

/** One step the recording has produced. */
interface StepState {
  readonly stepId: string
  action: RecorderAction
  isPassword: boolean
  /** The placeholder secret this step was given, kept so its updates keep the same name. */
  unsetSecret?: string
  /** The last update was held back because it ended in the start of a secret. */
  withheld: boolean
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
 *
 * Every value goes through {@link templateFill} or {@link templateUrl} before
 * it is returned, and a step whose config would still contain a secret is
 * dropped: what this returns may be sent to the renderer as it is.
 */
export class RecordingConverter {
  private readonly steps: StepState[] = []
  /** The step the last recorder action became, which an `updated` event replaces. Null when it became none. */
  private current: StepState | null = null
  private sawFirstPage = false
  private readonly warned = new Set<keyof typeof WARNINGS>()
  private unsetCount = 0

  public constructor(
    private readonly values: RecordingValues,
    private readonly newStepId: () => string,
    /** Secret names the workflow already uses: a placeholder never takes one, set or not. */
    private readonly takenSecretNames: ReadonlySet<string> = new Set(),
  ) {}

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
   * End the recording: a step still held back because it ended in the start
   * of a secret becomes a placeholder secret, so the partial value is never sent.
   */
  public finish(): ConverterOutput {
    const steps: RecordedStep[] = []
    for (const state of this.steps) {
      if (!state.withheld || state.action.selector === undefined) continue
      const locator = parseRecordedSelector(state.action.selector)
      if (locator === null) continue
      state.unsetSecret ??= this.nextUnsetSecret("UNSET_SECRET")
      state.withheld = false
      const config: BrowserNodeData = { action: "fill", locator, value: `{{secrets.${state.unsetSecret}}}` }
      state.sent = JSON.stringify(config)
      steps.push({ stepId: state.stepId, config })
    }
    return { steps, warnings: [] }
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
  private emit(state: StepState, warnings: string[]): RecordedStep[] {
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
      return url === null ? { kind: "skip", warning: "secretUrl" } : this.checked({ action: "navigate", url })
    }
    if (action.name.startsWith("assert")) return { kind: "skip", warning: "check" }
    if (action.name === "setInputFiles") return { kind: "skip", warning: "upload" }
    const locator = action.selector === undefined ? undefined : parseRecordedSelector(action.selector)
    if (locator === null) return { kind: "skip", warning: "element" }
    if (action.name === "press") {
      if (action.key === undefined) return { kind: "skip" }
      const key = [...modifierKeys(action.modifiers), action.key].join("+")
      return this.checked({ action: "press", key, ...(locator === undefined ? {} : { locator }) })
    }
    if (locator === undefined) return { kind: "skip" }
    return this.convertOnElement(state, locator)
  }

  private convertOnElement(state: StepState, locator: BrowserLocator): Converted {
    const { action } = state
    switch (action.name) {
      case "click": {
        const modifiers = modifierKeys(action.modifiers)
        const clickCount = Math.min(action.clickCount ?? 1, 3)
        const button = action.button === "right" || action.button === "middle" ? action.button : undefined
        return this.checked({
          action: "click",
          locator,
          ...(button === undefined ? {} : { button }),
          ...(clickCount > 1 ? { clickCount } : {}),
          ...(modifiers.length > 0 ? { modifiers } : {}),
        })
      }
      case "fill":
        return this.convertFill(state, locator)
      case "check":
      case "uncheck":
      case "hover":
        return this.checked({ action: action.name, locator })
      case "select":
        return action.options === undefined || action.options.length === 0
          ? { kind: "skip" }
          : this.checked({ action: "select", locator, values: [...action.options] })
      default:
        return { kind: "skip" }
    }
  }

  private convertFill(state: StepState, locator: BrowserLocator): Converted {
    const templated = templateFill(state.action.text ?? "", this.values, state.isPassword)
    if (templated.kind === "withheld") return templated
    if (templated.kind === "unset") state.unsetSecret ??= this.nextUnsetSecret("UNSET_PASSWORD")
    const value = templated.kind === "unset" ? `{{secrets.${state.unsetSecret}}}` : templated.value
    return this.checked({ action: "fill", locator, value })
  }

  /** The config, if it is valid and carries no secret anywhere (a locator can show page text). */
  private checked(config: BrowserNodeData): Converted {
    if (containsSecret(JSON.stringify(config), this.values)) return { kind: "skip", warning: "secretStep" }
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
