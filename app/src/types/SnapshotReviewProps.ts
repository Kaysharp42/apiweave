import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";

export interface SnapshotReviewProps {
  /** The node that holds the rules: its id keys each rule's baseline. */
  nodeId: string;
  /** This run's evaluations of the node's rules; only `matchesSnapshot` ones are shown. */
  assertions: readonly AssertionEvaluation[];
  /** The value a rule compared, recorded as its new baseline; `undefined` when it cannot be read. */
  readActual: (rule: AssertionEvaluation) => unknown;
  /** List where each failed snapshot differs. Off where the panel already lists them. */
  showDifferences?: boolean;
}
