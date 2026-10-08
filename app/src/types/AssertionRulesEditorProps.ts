import type { AssertionItem } from "./AssertionItem";

export interface AssertionRulesEditorProps {
  rules: AssertionItem[];
  onChange: (rules: AssertionItem[]) => void;
  /** What the `prev` source reads: the upstream result for an Assertion node, the request's own response for Retry until. */
  responseLabel?: string;
}
