import type { FrameLocator, Locator } from "playwright-core"
import type { BrowserAriaRole } from "@shared/types/BrowserAriaRole"
import type { BrowserLocator } from "@shared/types/BrowserLocator"

/**
 * The calls a locator chain is built from. `Page`, `Locator` and `FrameLocator`
 * all have them, so a chain can start at the page, inside a parent element
 * (`within`) or inside an iframe (`frame`).
 */
export interface LocatorRoot {
  locator(selector: string): Locator
  getByRole(role: BrowserAriaRole, options?: { name?: string; exact?: boolean }): Locator
  getByLabel(text: string, options?: { exact?: boolean }): Locator
  getByPlaceholder(text: string, options?: { exact?: boolean }): Locator
  getByText(text: string, options?: { exact?: boolean }): Locator
  getByAltText(text: string, options?: { exact?: boolean }): Locator
  getByTitle(text: string, options?: { exact?: boolean }): Locator
  getByTestId(testId: string): Locator
}

function exactOption(exact: boolean | undefined): { exact?: boolean } {
  return exact === undefined ? {} : { exact }
}

function byKind(root: LocatorRoot, locator: BrowserLocator, resolve: (text: string) => string): Locator {
  switch (locator.kind) {
    case "role":
      return root.getByRole(locator.role, {
        ...(locator.name !== undefined ? { name: resolve(locator.name) } : {}),
        ...exactOption(locator.exact),
      })
    case "label":
      return root.getByLabel(resolve(locator.value), exactOption(locator.exact))
    case "placeholder":
      return root.getByPlaceholder(resolve(locator.value), exactOption(locator.exact))
    case "text":
      return root.getByText(resolve(locator.value), exactOption(locator.exact))
    case "alt":
      return root.getByAltText(resolve(locator.value), exactOption(locator.exact))
    case "title":
      return root.getByTitle(resolve(locator.value), exactOption(locator.exact))
    case "testId":
      return root.getByTestId(resolve(locator.value))
    case "css":
    case "selector":
      return root.locator(resolve(locator.value))
  }
}

/**
 * The Playwright locator for `locator`, built outside-in: the iframe, then the
 * parent (`within`), then the element's own kind, then `hasText`, then `nth`.
 * Only public Playwright methods are used. `resolve` fills placeholders in
 * every value.
 */
export function buildLocator(root: LocatorRoot, locator: BrowserLocator, resolve: (text: string) => string): Locator {
  let scope: LocatorRoot = root
  if (locator.frame !== undefined) {
    const frame: FrameLocator = scope.locator(resolve(locator.frame)).contentFrame()
    scope = frame
  }
  if (locator.within !== undefined) scope = buildLocator(scope, locator.within, resolve)
  let element = byKind(scope, locator, resolve)
  if (locator.hasText !== undefined) element = element.filter({ hasText: resolve(locator.hasText) })
  if (locator.nth !== undefined) element = locator.nth === -1 ? element.last() : element.nth(locator.nth)
  return element
}
