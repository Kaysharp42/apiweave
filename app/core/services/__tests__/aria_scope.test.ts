import { describe, expect, it } from "vitest"
import { scopeAriaSnapshot } from "../aria_scope"

/**
 * The line shapes Playwright's `ariaSnapshot()` writes, from the fixtures the
 * runner's own tests use (`outcome_check.test.ts`): bare roles, quoted names
 * with colons and escaped quotes, attribute lists, inline text values,
 * `/url`-style properties, and a whole key single-quoted when the name holds
 * YAML-special characters.
 */
const PAGE = [
  "- banner [ref=e1]:",
  '  - heading "Shop: \"Premier\"" [level=1] [ref=e2]',
  "  - 'link \"Sale: 50% off\" [ref=e3]':",
  "    - /url: /sale",
  "- main [ref=e4]:",
  '  - textbox "Email": ann@example.test',
  '  - textbox "Password": <SECRET>',
  '  - button "Sign in"',
  "  - status [ref=e7]: \"- yes: no\"",
  '- dialog "Save changes?" [ref=e8]:',
  '  - heading "Sure: discard edits?" [level=2] [ref=e9]',
  '  - button "OK" [ref=e10]',
  '- alertdialog "Session expired" [ref=e11]:',
  '  - button "Sign in again" [ref=e12]',
].join("\n")

const MAIN_SUBTREE = [
  "- main [ref=e4]:",
  '  - textbox "Email": ann@example.test',
  '  - textbox "Password": <SECRET>',
  '  - button "Sign in"',
  '  - status [ref=e7]: "- yes: no"',
].join("\n")

// The LAST dialog in document order — the alertdialog — not the first.
const LAST_DIALOG_SUBTREE = [
  '- alertdialog "Session expired" [ref=e11]:',
  '  - button "Sign in again" [ref=e12]',
].join("\n")

describe("scopeAriaSnapshot", () => {
  it("auto prefers the last dialog over the main landmark, and says what else it left out", () => {
    const scoped = scopeAriaSnapshot(PAGE, "auto")
    expect(scoped).toEqual({
      text: LAST_DIALOG_SUBTREE,
      applied: "dialog",
      note: '1 other dialog and a main landmark are also on the page; scope "page" shows them.',
    })
  })

  it("names the other dialog or the main landmark an auto dialog skipped, short and only for auto", () => {
    // A consent banner rendered as a dialog is the common trap: the page also
    // has the real content, and the agent would otherwise never learn of it.
    const banner = [
      '- dialog "Cookies" [ref=e1]:',
      '  - button "Accept"',
      "- main [ref=e2]:",
      '  - button "Sign in"',
      '- dialog "Checkout" [ref=e3]:',
      '  - button "Pay"',
    ].join("\n")
    expect(scopeAriaSnapshot(banner, "auto")).toEqual({
      text: '- dialog "Checkout" [ref=e3]:\n  - button "Pay"',
      applied: "dialog",
      note: '1 other dialog and a main landmark are also on the page; scope "page" shows them.',
    })
    // Naming a scope is a choice: only auto explains what it chose against.
    expect(scopeAriaSnapshot(banner, "dialog").note).toBeUndefined()

    // Only another dialog.
    const twoDialogs = [
      '- dialog "Cookies" [ref=e1]:',
      '  - button "Accept"',
      '- dialog "Checkout" [ref=e2]:',
      '  - button "Pay"',
    ].join("\n")
    expect(scopeAriaSnapshot(twoDialogs, "auto").note).toBe('1 other dialog is also on the page; scope "page" shows it.')

    // Only a main landmark, and a main nested in the chosen dialog is part of
    // the extracted text, so it is not "other" content.
    const withMain = ['- main [ref=e1]:', '  - textbox "Search"', '- dialog "Pick" [ref=e2]:', '  - button "OK"'].join("\n")
    expect(scopeAriaSnapshot(withMain, "auto").note).toBe('A main landmark is also on the page; scope "main" or "page" shows it.')
    const nestedMain = ['- dialog "Pick" [ref=e1]:', "  - main [ref=e2]:", '    - button "OK"'].join("\n")
    expect(scopeAriaSnapshot(nestedMain, "auto")).toEqual({
      text: '- dialog "Pick" [ref=e1]:\n  - main [ref=e2]:\n    - button "OK"',
      applied: "dialog",
    })
    // A lone dialog explains nothing extra.
    expect(scopeAriaSnapshot('- dialog "Pick" [ref=e1]:\n  - button "OK"', "auto").note).toBeUndefined()
  })

  it("warns that a truncated stored snapshot may have lost the dialog or later content", () => {
    // capturePage cuts a snapshot at its cap and appends the marker at column
    // 0, so it always falls outside an extracted subtree: the dialog that was
    // cut away can turn "auto" into a silent main, which is the bug the note
    // names.
    const mainOnly = ["- main [ref=e1]:", '  - button "Continue"', "… (truncated)"].join("\n")
    expect(scopeAriaSnapshot(mainOnly, "auto")).toEqual({
      text: '- main [ref=e1]:\n  - button "Continue"',
      applied: "main",
      note:
        'The stored ARIA snapshot was truncated when it was captured, so a dialog or later content may be missing; scope "page" shows what was kept.',
    })

    // "page" already returns the marker, so it needs no duplicate note.
    const whole = scopeAriaSnapshot(mainOnly, "page")
    expect(whole.text).toBe(mainOnly)
    expect(whole.note).toBeUndefined()

    // A dialog before the cut still scopes, but the cut is still stated.
    const dialogFirst = ['- dialog "Confirm" [ref=e1]:', '  - button "OK"', "… (truncated)"].join("\n")
    const scoped = scopeAriaSnapshot(dialogFirst, "dialog")
    expect(scoped.text).toBe('- dialog "Confirm" [ref=e1]:\n  - button "OK"')
    expect(scoped.note).toMatch(/truncated/)
    expect(scoped.note).toMatch(/scope "page"/)
  })

  it("dialog extracts the last dialog or alertdialog, dedented to column 0", () => {
    expect(scopeAriaSnapshot(PAGE, "dialog")).toEqual({ text: LAST_DIALOG_SUBTREE, applied: "dialog" })
  })

  it("main extracts the first main landmark with its subtree", () => {
    expect(scopeAriaSnapshot(PAGE, "main")).toEqual({ text: MAIN_SUBTREE, applied: "main" })
  })

  it("page returns the snapshot unchanged, without a note", () => {
    expect(scopeAriaSnapshot(PAGE, "page")).toEqual({ text: PAGE, applied: "page" })
    // Default scope is auto, not page: a page with no dialog and no main
    // still reports page, but with a note.
    const plain = '- heading "Sign in" [level=1]\n- button "Sign in"'
    expect(scopeAriaSnapshot(plain)).toEqual({
      text: plain,
      applied: "page",
      note: "No dialog or main landmark in this ARIA snapshot; returned the whole page.",
    })
  })

  it("falls back to the whole page, with a note, when the named scope is absent", () => {
    const plain = "- generic [ref=e1]:\n  - button \"OK\""
    expect(scopeAriaSnapshot(plain, "dialog")).toEqual({
      text: plain,
      applied: "page",
      note: "No dialog in this ARIA snapshot; returned the whole page instead.",
    })
    expect(scopeAriaSnapshot(plain, "main")).toEqual({
      text: plain,
      applied: "page",
      note: "No main landmark in this ARIA snapshot; returned the whole page instead.",
    })
  })

  it("picks the first main when the page has several, and the first main also wins inside auto when no dialog is open", () => {
    const two = ["- main [ref=e1]:", '  - textbox "Search"', "- main [ref=e2]:", '  - button "Second"'].join("\n")
    expect(scopeAriaSnapshot(two, "main")).toEqual({ text: '- main [ref=e1]:\n  - textbox "Search"', applied: "main" })
    // The second main is content the first one left out, so auto says so.
    expect(scopeAriaSnapshot(two, "auto")).toEqual({
      text: '- main [ref=e1]:\n  - textbox "Search"',
      applied: "main",
      note: 'Content outside the main landmark is also on the page; scope "page" shows it.',
    })
  })

  it("says when auto's main landmark is not the whole page, so scope \"page\" is one call away", () => {
    // The common trap FB-041 names: an overlay or banner outside `main`, with
    // no dialog role anywhere, so auto silently reads the landmark only.
    const withBanner = [
      "- banner [ref=e1]:",
      '  - link "Shop"',
      "- main [ref=e2]:",
      '  - button "Continue"',
    ].join("\n")
    expect(scopeAriaSnapshot(withBanner, "auto")).toEqual({
      text: '- main [ref=e2]:\n  - button "Continue"',
      applied: "main",
      note: 'Content outside the main landmark is also on the page; scope "page" shows it.',
    })
    // Naming a scope is a choice: only auto explains what it chose against.
    expect(scopeAriaSnapshot(withBanner, "main").note).toBeUndefined()
    // Nothing outside the landmark: nothing to explain.
    const onlyMain = ["- main [ref=e1]:", '  - button "Continue"'].join("\n")
    expect(scopeAriaSnapshot(onlyMain, "auto")).toEqual({ text: '- main [ref=e1]:\n  - button "Continue"', applied: "main" })
    // The truncation marker is the stored snapshot's own fact, stated by its
    // own note; it is not counted as page content outside the landmark.
    const cut = ["- main [ref=e1]:", '  - button "Continue"', "… (truncated)"].join("\n")
    expect(scopeAriaSnapshot(cut, "auto").note).toBe(
      'The stored ARIA snapshot was truncated when it was captured, so a dialog or later content may be missing; scope "page" shows what was kept.',
    )
  })

  it("keeps a nested dialog's deeper subtree, including non-item lines indented under it", () => {
    const nested = [
      "- generic [ref=e1]:",
      '  - dialog "Pick one" [ref=e2]:',
      '    - heading "Choose" [level=2]',
      "      continuation line without a dash",
      '    - button "Go"',
      '  - button "Outside"',
    ].join("\n")
    expect(scopeAriaSnapshot(nested, "dialog")).toEqual({
      text: [
        '- dialog "Pick one" [ref=e2]:',
        '  - heading "Choose" [level=2]',
        "    continuation line without a dash",
        '  - button "Go"',
      ].join("\n"),
      applied: "dialog",
    })
  })

  it("reads quoted names containing colons, and never mistakes a text value for a role", () => {
    // The inline text value names `main` and `dialog`; neither line is one.
    const decoy = [
      "- generic [ref=e1]:",
      '  - text: use main here, not dialog',
      "- main [ref=e2]:",
      '  - button "Continue"',
    ].join("\n")
    // The generic block ahead of the landmark is outside it, so auto says so.
    expect(scopeAriaSnapshot(decoy, "auto")).toEqual({
      text: '- main [ref=e2]:\n  - button "Continue"',
      applied: "main",
      note: 'Content outside the main landmark is also on the page; scope "page" shows it.',
    })
    // A single-quoted key (a name holding escaped quotes) still names its role;
    // the extraction keeps the line verbatim once dedented.
    const quoted = '  - \'dialog "Step 2: \\"go\\" #1" [ref=e3]\':\n    - button "OK"'
    expect(scopeAriaSnapshot(quoted, "dialog")).toEqual({
      text: '- \'dialog "Step 2: \\"go\\" #1" [ref=e3]\':\n  - button "OK"',
      applied: "dialog",
    })
  })

  it("treats malformed input as the whole page instead of throwing", () => {
    expect(scopeAriaSnapshot("", "auto")).toEqual({
      text: "",
      applied: "page",
      note: "No dialog or main landmark in this ARIA snapshot; returned the whole page.",
    })
    for (const malformed of ["- [unclosed", ":\n:\n:", "not a snapshot at all", ""]) {
      const scoped = scopeAriaSnapshot(malformed, "dialog")
      expect(scoped.applied).toBe("page")
      expect(scoped.text).toBe(malformed)
      expect(scoped.note).toMatch(/No dialog/)
    }
    // A stored snapshot the runner itself cut mid-page keeps its truncation
    // marker under "page", and a scope extraction stops at the marker's line.
    const cut = '- dialog "Confirm" [ref=e9]:\n  - button "OK"\n… (truncated)'
    expect(scopeAriaSnapshot(cut, "page").text).toBe(cut)
    expect(scopeAriaSnapshot(cut, "dialog").text).toBe('- dialog "Confirm" [ref=e9]:\n  - button "OK"')
    // A bare leaf dialog is still a dialog: nothing about it is malformed.
    expect(scopeAriaSnapshot("- dialog", "dialog")).toEqual({ text: "- dialog", applied: "dialog" })
  })

  it("scopes text it did not write without ever throwing on odd characters", () => {
    const cjk = '- dialog "订单" [ref=e1]:\n  - button "确认 🚀"'
    const scoped = scopeAriaSnapshot(cjk, "auto")
    expect(scoped.applied).toBe("dialog")
    expect(Buffer.byteLength(scoped.text, "utf8")).toBe(Buffer.byteLength('- dialog "订单" [ref=e1]:\n  - button "确认 🚀"', "utf8"))
  })
})
