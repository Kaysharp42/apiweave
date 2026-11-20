import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Dialog } from "@headlessui/react";
import { Badge } from "../atoms/Badge";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { NodeStepButton } from "../molecules/NodeStepButton";
import { getNodeIcon } from "./nodeModalUtils";
import { getNodeModalTypeName } from "../../utils/nodeModalMeta";
import type { NodeModalTitleBarProps } from "../../types";

/**
 * The node editor's top row. Previous sits at the left edge and Next at the
 * right, so walking a workflow never means closing one node to open the next.
 */
export function NodeModalTitleBar({
  nodeId,
  nodeType,
  nodeLabel,
  onLabelChange,
  onClose,
  steps,
  nameRef,
}: NodeModalTitleBarProps) {
  const Icon = getNodeIcon(nodeType);
  const previousButtonRef = useRef<HTMLButtonElement | null>(null);
  const nextButtonRef = useRef<HTMLButtonElement | null>(null);
  const { arrivedBy } = steps;

  // After a step, focus the button it went by. A step taken with Alt+arrow
  // from a field leaves focus nowhere, since that field went with the old
  // node; on the button, the next bare arrow press steps again.
  useEffect(() => {
    if (arrivedBy === null) return;
    (arrivedBy === "next" ? nextButtonRef : previousButtonRef).current?.focus();
  }, [nodeId, arrivedBy]);

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
      <NodeStepButton
        direction="previous"
        steps={steps.previous}
        onStep={(step) => steps.onStep("previous", step)}
        triggerRef={previousButtonRef}
      />
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xs border border-border bg-surface-overlay text-primary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-primary-light">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <Dialog.Title className="sr-only">Edit {nodeLabel}</Dialog.Title>
        {/* Keyed: it seeds from `defaultValue` once, and the title bar
            outlives a step. */}
        <Input
          key={nodeId}
          ref={nameRef}
          defaultValue={nodeLabel}
          onChange={(event) => onLabelChange(event.target.value)}
          aria-label="Node name"
          className="h-8 border-transparent bg-transparent px-0 font-display text-base font-semibold hover:bg-surface-overlay focus:bg-surface-overlay dark:bg-transparent dark:hover:bg-surface-dark-overlay dark:focus:bg-surface-dark-overlay"
          placeholder="Enter node name"
        />
      </div>
      <Badge variant="secondary" size="sm" className="capitalize">
        {getNodeModalTypeName(nodeType)}
      </Badge>
      <NodeStepButton
        direction="next"
        steps={steps.next}
        onStep={(step) => steps.onStep("next", step)}
        triggerRef={nextButtonRef}
      />
      <IconButton tooltip="Close" size="sm" variant="ghost" onClick={onClose}>
        <X className="h-5 w-5" />
      </IconButton>
    </div>
  );
}
