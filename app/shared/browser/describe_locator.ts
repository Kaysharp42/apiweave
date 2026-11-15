import type { BrowserLocator } from "../types/BrowserLocator"

/** A JavaScript string literal in single quotes, the way Playwright prints locators. */
function quote(text: string): string {
  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n")}'`
}

function withExact(args: string, exact: boolean | undefined): string {
  return exact === true ? `${args}, { exact: true }` : args
}

/** The locator's own kind as one Playwright call, without its modifiers. */
function describeKind(locator: BrowserLocator): string {
  switch (locator.kind) {
    case "role": {
      const options = [
        ...(locator.name !== undefined ? [`name: ${quote(locator.name)}`] : []),
        ...(locator.exact === true ? ["exact: true"] : []),
      ]
      return `getByRole(${quote(locator.role)}${options.length > 0 ? `, { ${options.join(", ")} }` : ""})`
    }
    case "label":
      return `getByLabel(${withExact(quote(locator.value), locator.exact)})`
    case "placeholder":
      return `getByPlaceholder(${withExact(quote(locator.value), locator.exact)})`
    case "text":
      return `getByText(${withExact(quote(locator.value), locator.exact)})`
    case "alt":
      return `getByAltText(${withExact(quote(locator.value), locator.exact)})`
    case "title":
      return `getByTitle(${withExact(quote(locator.value), locator.exact)})`
    case "testId":
      return `getByTestId(${quote(locator.value)})`
    case "css":
    case "selector":
      return `locator(${quote(locator.value)})`
  }
}

/**
 * A locator as the Playwright code that finds the same element, e.g.
 * `getByRole('button', { name: 'Save' })` or
 * `locator('iframe').contentFrame().getByRole('listitem').filter({ hasText: 'Row B' }).nth(1)`.
 * Built from the config as written, so placeholders stay unresolved: it is
 * safe to show anywhere, including a stored error.
 */
export function describeLocator(locator: BrowserLocator): string {
  const parts: string[] = []
  if (locator.frame !== undefined) parts.push(`locator(${quote(locator.frame)}).contentFrame()`)
  if (locator.within !== undefined) parts.push(describeLocator(locator.within))
  parts.push(describeKind(locator))
  if (locator.hasText !== undefined) parts.push(`filter({ hasText: ${quote(locator.hasText)} })`)
  if (locator.nth !== undefined) parts.push(locator.nth === -1 ? "last()" : `nth(${locator.nth})`)
  return parts.join(".")
}
