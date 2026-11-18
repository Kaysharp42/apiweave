import { useContext, useState } from "react";
import { Button } from "../atoms/Button";
import WorkflowContext from "../../contexts/WorkflowContext";
import useSidebarStore from "../../stores/SidebarStore";
import { apiweave } from "../../utils/apiweaveClient";
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation";
import type { SnapshotReviewProps } from "../../types/SnapshotReviewProps";
import { ValueViolations } from "./ValueViolations";

/**
 * A node's `matchesSnapshot` rules after a run: where each failed one differs,
 * and an Accept snapshot button per rule that records what this run saw as the
 * rule's new baseline. Baselines are keyed by the node holding the rule, so an
 * Assertion node's rules are accepted under its own id even though the value
 * comes from the node it inspected.
 */
export function SnapshotReview({ nodeId, assertions, readActual, showDifferences = false }: SnapshotReviewProps) {
  const workflowId = useContext(WorkflowContext)?.workflowId;
  const workspaceId = useSidebarStore((state: { activeWorkspaceId: string | null }) => state.activeWorkspaceId);
  const [acceptedRules, setAcceptedRules] = useState<readonly number[]>([]);
  const snapshotRules = assertions.filter((rule) => rule.operator === "matchesSnapshot");
  if (snapshotRules.length === 0) return null;

  const accept = async (rule: AssertionEvaluation): Promise<void> => {
    if (!workflowId || !workspaceId) return;
    await apiweave.runs.acceptSnapshot({
      workspaceId,
      workflowId,
      nodeId,
      ruleIndex: rule.ruleIndex,
      value: readActual(rule) ?? null,
    });
    setAcceptedRules((current) => [...current, rule.ruleIndex]);
  };

  const differences = showDifferences
    ? snapshotRules.filter((rule) => rule.outcome === "fail").flatMap((rule) => rule.schemaErrors ?? [])
    : [];

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {snapshotRules.map((rule) => (
          <Button
            key={rule.ruleIndex}
            variant="secondary"
            size="xs"
            disabled={readActual(rule) === undefined}
            onClick={() => {
              void accept(rule);
            }}
          >
            {acceptedRules.includes(rule.ruleIndex) ? "Snapshot accepted" : `Accept snapshot #${rule.ruleIndex + 1}`}
          </Button>
        ))}
      </div>
      <ValueViolations label="Snapshot differences" violations={differences} />
    </div>
  );
}
