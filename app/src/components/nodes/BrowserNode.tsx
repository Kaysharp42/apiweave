import { memo, useMemo } from "react";
import {
  CircleCheck,
  Download,
  Globe,
  Keyboard,
  ListChecks,
  MousePointer2,
  MousePointerClick,
  SquareCheck,
  TextCursorInput,
  type LucideIcon,
} from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { Badge } from "../atoms/Badge";
import { BrowserNodeBody } from "./BrowserNodeBody";
import { secretNameOf } from "../node-modal/SecretNameField";
import { useSecretNamesInScope } from "../../hooks/useSecretNamesInScope";
import { formatDuration } from "../../utils/formatNodeMetrics";
import { browserStepSummary, draftFromConfig } from "../../utils/browserStep";
import type { BrowserAction } from "@shared/types/BrowserAction";
import type { BrowserNodeProps } from "../../types/BrowserNodeProps";

const ACTION_ICONS: Readonly<Record<BrowserAction, LucideIcon>> = {
  navigate: Globe,
  click: MousePointerClick,
  fill: TextCursorInput,
  press: Keyboard,
  select: ListChecks,
  check: SquareCheck,
  uncheck: SquareCheck,
  hover: MousePointer2,
  "expect-visible": CircleCheck,
  "expect-text": CircleCheck,
  "expect-value": CircleCheck,
  "expect-url": CircleCheck,
  extract: Download,
};

/** One browser step on the canvas: what it does at rest, and where the page was after it ran. */
function BrowserNode({ id, data, selected }: BrowserNodeProps) {
  const draft = draftFromConfig(data.config);
  const action = draft.action;
  const summary = browserStepSummary(data.config);
  const { names } = useSecretNamesInScope();
  // A recorded password that matched no stored secret is `{{secrets.UNSET_PASSWORD_1}}` until the user sets it.
  const secret = action === "fill" ? secretNameOf(draft.value) : "";
  const needsSecret = secret !== "" && names !== null && !names.includes(secret);
  const status = data.executionStatus ?? "idle";
  const page = data.executionResult?.browser?.title ?? data.executionResult?.browser?.url;
  const Icon = ACTION_ICONS[action];
  const icon = useMemo(() => <Icon className="h-4 w-4" />, [Icon]);

  return (
    <BaseNode
      title={data.label ?? "Browser step"}
      icon={icon}
      tileHue="var(--aw-method-head)"
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="browser"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      typeChip={
        <>
          {needsSecret && (
            <Badge variant="warning" size="sm" className="shrink-0" title={`The secret ${secret} is not set: a run fails this step`}>
              needs secret
            </Badge>
          )}
          <span className="rounded-node-chip bg-method-head/10 px-1.5 py-0.5 font-mono text-2xs text-method-head">WEB</span>
        </>
      }
      restLine={summary}
      activityLine={summary}
      {...(page === undefined ? {} : { resultSummary: { operation: "on", argument: page } })}
      metrics={[{ label: "duration", value: formatDuration(data.executionResult?.duration) }]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-node-compact"
    >
      {({ isExpanded }) =>
        isExpanded ? (
          <BrowserNodeBody nodeId={id} status={status} summary={summary} result={data.executionResult} />
        ) : null
      }
    </BaseNode>
  );
}

export default memo(BrowserNode);
