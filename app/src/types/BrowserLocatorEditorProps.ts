import type { BrowserLocator } from "@shared/types/BrowserLocator";

export interface BrowserLocatorEditorProps {
  locator: BrowserLocator;
  onChange: (locator: BrowserLocator) => void;
  /** Nesting level of a parent (`within`) editor; the outermost is 0. */
  depth?: number;
}
