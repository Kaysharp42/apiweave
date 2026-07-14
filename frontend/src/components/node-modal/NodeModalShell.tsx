import { useState } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import Tippy from "@tippyjs/react";
import { Eye, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import { Dialog } from "@headlessui/react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Input } from "../atoms/Input";
import { Badge } from "../atoms/Badge";
import { Modal } from "../molecules/Modal";
import { PanelTabs } from "../molecules/PanelTabs";
import { getNodeIcon } from "./nodeModalUtils";
import type {
  NodeModalRequestBarProps,
  NodeModalResponsePaneProps,
  NodeModalShellProps,
  NodeModalVerticalTabsProps,
} from "../../types";

export function NodeModalRequestBar({ children }: NodeModalRequestBarProps) {
  return (
    <div className="sticky top-0 z-20 flex min-h-14 flex-shrink-0 items-center border-b border-border bg-surface-raised/95 px-4 py-2 backdrop-blur dark:border-border-dark dark:bg-surface-dark-raised/95">
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
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-surface-overlay px-4 py-2 dark:border-border-dark dark:bg-surface-dark-overlay">
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

export function NodeModalShell({
  open,
  nodeType,
  nodeLabel,
  tabs,
  activeTab,
  onTabChange,
  onLabelChange,
  onClose,
  onCancel,
  onSave,
  initialFocus,
  requestBar,
  children,
  responsePane,
}: NodeModalShellProps) {
  const [responseCollapsed, setResponseCollapsed] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768,
  );
  const Icon = getNodeIcon(nodeType);
  const typeLabel = nodeType === "http-request" ? "HTTP Request" : nodeType;

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title=""
      size="fullscreen"
      scrollable={false}
      showClose={false}
      {...(initialFocus && { initialFocus })}
      className="!max-w-[1800px] !rounded-sm !shadow-[var(--aw-shadow-modal)]"
    >
      <div className="flex h-full min-h-0 flex-col bg-surface-raised dark:bg-surface-dark-raised">
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3 dark:border-border-dark">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm border border-border bg-surface-overlay text-primary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-primary-light">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <Dialog.Title className="sr-only">Edit {nodeLabel}</Dialog.Title>
            <Input
              ref={(element) => {
                if (initialFocus) initialFocus.current = element;
              }}
              defaultValue={nodeLabel}
              onChange={(event) => onLabelChange(event.target.value)}
              aria-label="Node name"
              className="h-8 border-transparent bg-transparent px-0 font-display text-base font-semibold hover:bg-surface-overlay focus:bg-surface-overlay dark:bg-transparent dark:hover:bg-surface-dark-overlay dark:focus:bg-surface-dark-overlay"
              placeholder="Enter node name"
            />
          </div>
          <Badge variant="secondary" size="sm" className="capitalize">
            {typeLabel}
          </Badge>
          <IconButton
            tooltip="Close"
            size="sm"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </IconButton>
        </div>

        <NodeModalRequestBar>{requestBar}</NodeModalRequestBar>

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
                <div
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
                    {responsePane}
                  </NodeModalResponsePane>
                </Allotment.Pane>
              )}
            </Allotment>
            {responseCollapsed && (
              <Tippy content="Show response" placement="left" delay={[300, 0]}>
                <button
                  type="button"
                  onClick={() => setResponseCollapsed(false)}
                  aria-label="Show response"
                  className="absolute right-0 top-0 z-30 flex h-full w-9 flex-col items-center justify-center gap-3 border-l border-border bg-surface-overlay text-text-secondary transition-colors duration-[var(--aw-transition-fast)] ease-in-out hover:bg-primary/10 hover:text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark dark:hover:bg-primary-light/10 dark:hover:text-primary-light"
                >
                  <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
                  <span
                    className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    Response
                  </span>
                </button>
              </Tippy>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3 dark:border-border-dark">
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button onClick={onSave} variant="primary">
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
