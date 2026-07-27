import type { AssertionOperator } from "@shared/types/AssertionOperator";
import type { AssertionSource } from "@shared/types/AssertionSource";

export interface AssertionValue {
  source: AssertionSource;
  path: string;
  operator: AssertionOperator;
  expectedValue: string;
}
