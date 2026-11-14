import type { AssertionOperator } from "@shared/types/AssertionOperator";
import type { AssertionSource } from "@shared/types/AssertionSource";

export interface AssertionItem {
  source: AssertionSource;
  path: string;
  operator: AssertionOperator;
  expectedValue: string;
  /** Only for "matchesSnapshot": JSONPath expressions whose values are ignored when comparing. */
  ignorePaths?: string[];
}
