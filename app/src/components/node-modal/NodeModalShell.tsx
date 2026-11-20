import { Fragment, useState } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Tooltip } from "../atoms/Tooltip";
import { Eye, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { PanelTabs } from "../molecules/PanelTabs";
import { NodeModalTitleBar } from "./NodeModalTitleBar";
import type {
  NodeModalRequestBarProps,
  NodeModalResponsePaneProps,
  NodeModalShellProps,
  NodeModalVerticalTabsProps,
} from "../../types";

export function NodeModalRequestBar({ children }: NodeModalRequestBarProps) {
  return (
    <div className="sticky top-0 z-20 flex min-h-14 shrink-0 items-center border-b border-border bg-surface-raised/95 px-4 py-2 backdrop-blur-sm dark:border-border-dark dark:bg-surface-dark-raised/95">
      {children}
    </div>
  );
}

export function NodeModalVerticalTabs({
  tabs,
  activeTab,
  onTabChange,
}: NodeModalVerticalTabsProps) {
  return (
    <PanelTabs
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
    />
  );
}

export function NodeModalResponsePane({
  children,
  title = "Response",
  onHide,
}: NodeModalResponsePaneProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-raised dark:bg-surface-dark-raised">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface-overlay px-4 py-2 dark:border-border-dark dark:bg-surface-dark-overlay">
        <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-text-primary dark:text-text-primary-dark">
          <Eye
            className="h-4 w-4 text-text-muted dark:text-text-muted-dark"
            aria-hidden="true"
          />
          {title}
        </div>
        {onHide && (
          <IconButton
            tooltip="Hide response"
            size="sm"
            variant="ghost"
            onClick={onHide}
          >
            <PanelRightClose className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * The node editor's layout. It stays mounted while the editor steps from node
 * to node: only the parts keyed by `nodeId` are rebuilt, so the split keeps
 * its sizes and the response pane stays open or hidden as it was.
 */
export function NodeModalShell({
  nodeId,
  nodeType,
  nodeLabel,
  tabs,
  activeTab,
  onTabChange,
  onLabelChange,
  onClose,
  onCancel,
  onSave,
  steps,
  nameRef,
  requestBar,
  children,
  responsePane,
}: NodeModalShellProps) {
  const [responseCollapsed, setResponseCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768,
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-raised dark:bg-surface-dark-raised">
      <NodeModalTitleBar
        nodeId={nodeId}
        nodeType={nodeType}
        nodeLabel={nodeLabel}
        onLabelChange={onLabelChange}
        onClose={onClose}
        steps={steps}
        nameRef={(element) => {
          nameRef.current = element;
        }}
      />

      <NodeModalRequestBar>
        <Fragment key={nodeId}>{requestBar}</Fragment>
      </NodeModalRequestBar>

      <div className="flex min-h-0 flex-1 flex-col">
        <NodeModalVerticalTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={onTabChange}
        />
        <div className="relative min-h-0 min-w-0 flex-1 bg-surface dark:bg-surface-dark">
          <Allotment className="h-full">
            <Allotment.Pane
              minSize={360}
              preferredSize={responseCollapsed ? "100%" : "58%"}
            >
              {/* Keyed so the next node's form starts at its top, not at the
                  previous node's scroll position. */}
              <div
                key={nodeId}
                className={`h-full min-h-0 overflow-y-auto p-4 ${responseCollapsed ? "pr-12" : ""}`}
              >
                {children}
              </div>
            </Allotment.Pane>
            {!responseCollapsed && (
              <Allotment.Pane minSize={340} preferredSize="42%">
                <NodeModalResponsePane
                  onHide={() => setResponseCollapsed(true)}
                >
                  <Fragment key={nodeId}>{responsePane}</Fragment>
                </NodeModalResponsePane>
              </Allotment.Pane>
            )}
          </Allotment>
          {responseCollapsed && (
            <Tooltip content="Show response" placement="left">
              <button
                type="button"
                onClick={() => setResponseCollapsed(false)}
                aria-label="Show response"
                className="absolute right-0 top-0 z-30 flex h-full w-9 flex-col items-center justify-center gap-3 border-l border-border bg-surface-overlay text-text-secondary transition-colors duration-(--aw-transition-fast) ease-in-out hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset) dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark dark:hover:bg-primary-light/10 dark:hover:text-primary-light"
              >
                <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                <span
                  className="font-mono text-2xs font-semibold uppercase tracking-[0.18em]"
                  style={{ writingMode: "vertical-rl" }}
                >
                  Response
                </span>
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 dark:border-border-dark">
        <Button onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        <Button onClick={onSave} variant="primary">
          Save
        </Button>
      </div>
    </div>
  );
}
