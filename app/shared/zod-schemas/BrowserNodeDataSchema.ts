import { z } from "zod"
import { BrowserLocatorSchema } from "./BrowserLocatorSchema"

/** Fields every browser step shares, spread into each union member. */
const stepBase = {
  timeoutMs: z
    .number()
    .int()
    .min(100)
    .max(300_000)
    .optional()
    .describe("Maximum time this step waits for its condition, in milliseconds. Playwright auto-waits up to this long. Defaults to 10000 at run time, or 30000 for `navigate`."),
  description: z
    .string()
    .max(500)
    .optional()
    .describe('Free text describing the step, for the user. The canvas label falls back to a generated summary such as `Click "Save"` when it is empty.'),
  continueOnFail: z
    .boolean()
    .optional()
    .describe("When true, a failed step lets the run continue down the outgoing edge instead of stopping the branch."),
}

const locator = BrowserLocatorSchema.describe("The element this step acts on.")

const optionalLocator = BrowserLocatorSchema.optional().describe(
  "The element this step acts on. Omit it to act on the page itself, e.g. a key press on the focused element.",
)

const dialog = z
  .enum(["accept", "dismiss"])
  .optional()
  .describe(
    'How to answer a JavaScript dialog (alert, confirm or prompt) this step opens: "accept" clicks OK, "dismiss" cancels. Playwright dismisses dialogs by default, which cancels a confirm() flow, so set "accept" when the page asks for confirmation.',
  )

const match = z
  .enum(["equals", "contains", "matches"])
  .optional()
  .describe('How to compare: "equals" is the whole string, "contains" is a substring, "matches" is a JavaScript regular expression. Defaults to "contains" at run time.')

/**
 * One browser action: a single step in a web page, run by a real browser. The
 * runner turns it into one Playwright call, so a workflow reads as a list of
 * steps the user can see and edit.
 */
export const BrowserNodeDataSchema = z
  .discriminatedUnion("action", [
    z
      .object({
        action: z.literal("navigate"),
        url: z
          .string()
          .min(1)
          .describe('Page URL to open, e.g. "{{env.BASE_URL}}/login". Supports `{{env.*}}`, `{{variables.*}}` and `{{prev.*}}` placeholders. `{{secrets.*}}` is refused here. Maps to `page.goto(url, { waitUntil: "load" })`.'),
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("click"),
        locator,
        button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button to click with. Defaults to left."),
        clickCount: z.number().int().min(1).max(3).optional().describe("How many times to click, 1 to 3. Defaults to 1; 2 is a double-click."),
        modifiers: z
          .array(z.enum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))
          .max(4)
          .optional()
          .describe('Keys held down while clicking, e.g. ["Control"] for ctrl+click. "ControlOrMeta" is Control on Windows and Linux and Meta on macOS.'),
        dialog,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("fill"),
        locator,
        value: z
          .string()
          .describe("Text to type into the field, replacing what is there (`locator.fill(value)`). May be empty to clear the field. Supports `{{env.*}}`, `{{secrets.*}}`, `{{variables.*}}` and `{{prev.*}}` placeholders; this is the only browser field that accepts `{{secrets.*}}`. A password must always be `{{secrets.NAME}}`, never a literal, so the value never reaches the workflow, a stored result or a sync."),
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("press"),
        locator: optionalLocator,
        key: z
          .string()
          .min(1)
          .max(64)
          .describe('Key or chord to press, using Playwright key names: "Enter", "Tab", "Escape", "ArrowDown", or "Control+A" for a chord. With a locator the element is focused first (`locator.press(key)`); without one the page keyboard is used (`page.keyboard.press(key)`).'),
        dialog,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("check"),
        locator,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("uncheck"),
        locator,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("select"),
        locator,
        values: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe('Option(s) to select in a <select>, each matched against an option\'s value or its visible label (`locator.selectOption(values)`). Several values select several options in a multi-select. Each one supports `{{env.*}}`, `{{variables.*}}` and `{{prev.*}}` placeholders.'),
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("hover"),
        locator,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("expect-visible"),
        locator,
        visible: z
          .boolean()
          .optional()
          .describe('True (the default) waits until the element is visible; false waits until it is hidden or detached (`locator.waitFor({ state: "visible" | "hidden" })`).'),
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("expect-text"),
        locator,
        text: z
          .string()
          .describe("Expected text of the element, read with `locator.innerText()`. Supports `{{env.*}}`, `{{variables.*}}` and `{{prev.*}}` placeholders. `{{secrets.*}}` is refused here."),
        match,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("expect-value"),
        locator,
        value: z
          .string()
          .describe("Expected value of the form field, read with `locator.inputValue()`. Supports `{{env.*}}`, `{{variables.*}}` and `{{prev.*}}` placeholders. `{{secrets.*}}` is refused here."),
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("expect-url"),
        url: z
          .string()
          .min(1)
          .describe('Expected page URL, read with `page.url()`. Supports `{{env.*}}`, `{{variables.*}}` and `{{prev.*}}` placeholders. `{{secrets.*}}` is refused here.'),
        match,
        ...stepBase,
      })
      .strict(),
    z
      .object({
        action: z.literal("extract"),
        locator: optionalLocator,
        from: z
          .enum(["text", "value", "attribute", "url", "title"])
          .describe('What to read: the element\'s text (`locator.innerText()`), its form value (`locator.inputValue()`), one HTML attribute (`locator.getAttribute(attribute)`), the page URL (`page.url()`), or the page title (`page.title()`).'),
        attribute: z
          .string()
          .min(1)
          .max(256)
          .optional()
          .describe('HTML attribute to read when from is "attribute", e.g. "href" or "data-id". Required in that case.'),
        variable: z
          .string()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
          .describe("Workflow variable to write the value into. Later nodes read it as `{{variables.<variable>}}`."),
        ...stepBase,
      })
      .strict(),
  ])
  .superRefine((data, context) => {
    if (data.action !== "extract") return
    if (data.from === "attribute" && data.attribute === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["attribute"], message: 'An extract with from: "attribute" requires the attribute name.' })
    }
    if ((data.from === "text" || data.from === "value" || data.from === "attribute") && data.locator === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["locator"], message: `An extract with from: "${data.from}" requires a locator.` })
    }
  })
  .describe(
    "One browser action per node. All browser nodes in a run share one page, in order: they must form a single ordered chain, with no parallel browser branches. The first browser node is usually a `navigate`.",
  )
