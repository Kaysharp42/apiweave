import type { NodeModalNodeType } from "../../types/NodeModalNodeType";
import { getNodeIcon } from "./nodeModalUtils";
import { Button } from "../atoms/Button";
import { X } from "lucide-react";
import type { ChangeEvent } from "react";

interface NodeModalHeaderProps {
  nodeType: NodeModalNodeType;
  nodeLabel: string;
  onLabelChange: (newLabel: string) => void;
  onClose: () => void;
}

export function NodeModalHeader({
  nodeType,
  nodeLabel,
  onLabelChange,
  onClose,
}: NodeModalHeaderProps) {
  const Icon = getNodeIcon(nodeType);
  const typeName =
    nodeType === "http-request"
      ? "HTTP Request"
      : nodeType === "sse"
        ? "SSE Stream"
      : nodeType === "websocket"
        ? "WebSocket"
      : nodeType === "grpc"
        ? "gRPC Call"
      : nodeType === "assertion"
        ? "Assertion"
        : nodeType === "delay"
          ? "Delay"
          : nodeType === "merge"
            ? "Merge"
            : nodeType === "start"
              ? "Start"
              : "End";

  return (
    <div className="mb-4 flex items-start justify-between border-b border-border pb-4 dark:border-border-dark">
      <div className="flex flex-col gap-2 w-full pr-4">
        <div className="flex items-center gap-2 font-mono text-2xs font-medium uppercase tracking-widest text-text-secondary dark:text-text-secondary-dark">
          <Icon className="w-6 h-6" />
          <span>{typeName}</span>
        </div>
        <label
          htmlFor="node-modal-name"
          className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark"
        >
          Node Name
        </label>
        <input
          id="node-modal-name"
          type="text"
          defaultValue={nodeLabel || ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onLabelChange(e.target.value)
          }
          className="-ml-2 w-full rounded-xs border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-text-primary shadow-none outline-hidden transition-colors hover:bg-surface-overlay focus:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset) dark:text-text-primary-dark dark:hover:bg-surface-dark-overlay dark:focus:bg-surface-dark-overlay"
          placeholder="Enter node name"
        />
      </div>
      <Button
        onClick={onClose}
        variant="ghost"
        size="sm"
        className="min-w-0! p-1.5! text-text-muted transition-colors hover:text-text-primary dark:text-text-muted-dark dark:hover:text-text-primary-dark cursor-pointer"
        title="Close"
      >
        <X className="w-5 h-5" />
      </Button>
    </div>
  );
}
