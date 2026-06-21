import type { AssertionConfig } from "./AssertionConfig";

export interface AssertionResult {
  assertion: AssertionConfig;
  passed: boolean;
  actual?: unknown;
  message?: string;
}
