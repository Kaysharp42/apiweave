import { z } from "zod"

/**
 * The ARIA roles `page.getByRole()` accepts, copied verbatim from the first
 * parameter's string-literal union in `playwright-core` (`types.d.ts`). Keeping
 * it identical means a locator can never name a role Playwright would reject.
 */
export const BrowserAriaRoleSchema = z.enum([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "meter",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
])

const withinDescription =
  "Parent locator: this locator is searched inside it (`within.<this>`). Use it to disambiguate one repeated structure, such as the button in a specific table row."

/**
 * Fields every locator kind accepts. Each union member is this object extended
 * with its own kind fields, so the modifiers are defined once.
 */
const locatorBase = z.object({
  hasText: z
    .string()
    .min(1)
    .max(2_048)
    .optional()
    .describe("Keep only elements whose text contains this value (`locator.filter({ hasText })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
  nth: z
    .number()
    .int()
    .min(-1)
    .max(1_000)
    .optional()
    .describe("Pick one of several matches by index, zero-based (`locator.nth(n)`). -1 means the last match. Matches are in DOM order (for role locators, accessibility-tree order), which shifts when an element is hidden or removed, so an index can silently land on another element. In stacked overlays prefer a `css` locator on the element's `name` or `id`."),
  frame: z
    .string()
    .min(1)
    .max(2_048)
    .optional()
    .describe("CSS selector of the iframe the element is in. The rest of the locator is searched in that frame's content (`page.locator(frame).contentFrame()`)."),
})

/** The optional `exact` switch the name- and text-matched kinds share with `role`. */
const exactMatch = z
  .boolean()
  .optional()
  .describe("Match the name/value as the whole string instead of a case-insensitive substring (`exact: true` in the Playwright options).")

/**
 * A structured element locator. Every kind maps to a public Playwright method,
 * so an agent patches fields instead of learning Playwright's selector grammar.
 * The chain is applied outside-in: `frame`, then `within`, then the kind, then
 * `hasText`, then `nth`.
 *
 * `within` is a getter so the reference back to `BrowserLocatorSchema` stays
 * lazy: zod 4 resolves getters when the shape is first read, which is what lets
 * `z.toJSONSchema` emit a `$ref` instead of recursing for ever. Each member
 * repeats the getter — a spread would evaluate it eagerly, and a shared helper
 * would hit the same TypeScript cycle through the helper's return type.
 */
export const BrowserLocatorSchema = z
  .discriminatedUnion("kind", [
    locatorBase
      .extend({
        kind: z.literal("role"),
        role: BrowserAriaRoleSchema.describe('Accessible role of the element, e.g. "button", "textbox" or "heading". Prefer this kind: it is what the page exposes to the accessibility tree.'),
        name: z
          .string()
          .min(1)
          .max(2_048)
          .optional()
          .describe("Accessible name to match, e.g. the visible label of a button (`page.getByRole(role, { name })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
        exact: exactMatch,
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("label"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe("Label text of a form field (`page.getByLabel(value, { exact })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
        exact: exactMatch,
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("placeholder"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe("Placeholder text of an input (`page.getByPlaceholder(value, { exact })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
        exact: exactMatch,
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("text"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe("Visible text of the element (`page.getByText(value, { exact })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
        exact: exactMatch,
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("alt"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe("Alt text of an image (`page.getByAltText(value, { exact })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
        exact: exactMatch,
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("title"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe("Title attribute of the element (`page.getByTitle(value, { exact })`). Supports `{{env.X}}` and `{{variables.X}}` placeholders."),
        exact: exactMatch,
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("testId"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe('Test id of the element, usually its `data-testid` attribute (`page.getByTestId(value)`). Stable when the visible text changes.'),
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("css"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe('CSS selector, e.g. "#save" or ".row:first-child" (`page.locator(value)`). Author it only when no role, label or test id names the element.'),
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
    locatorBase
      .extend({
        kind: z.literal("selector"),
        value: z
          .string()
          .min(1)
          .max(2_048)
          .describe('A raw Playwright selector, only produced by the recorder when nothing better exists — never author it by hand. It runs through `page.locator(value)` and raises an analyzer notice.'),
        get within() {
          return BrowserLocatorSchema.optional().describe(withinDescription)
        },
      })
      .strict(),
  ])
  .describe("Which element a browser step acts on. Locator values may contain `{{env.X}}` and `{{variables.X}}` placeholders. Prefer `role`, then `label`, then `testId`; `css` and `selector` are fallbacks.")
