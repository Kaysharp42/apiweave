import type { AssertionItem } from "./AssertionItem";
import type { NodeModalAssertionFailureMode } from "./NodeModalAssertionFailureMode";

export interface NodeModalAssertionConfig {
  assertions: AssertionItem[];
  continueOnFail?: boolean;
  failureMode?: NodeModalAssertionFailureMode;
}
