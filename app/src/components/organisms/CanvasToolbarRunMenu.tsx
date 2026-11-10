import { ChevronDown } from "lucide-react";
import { Menu, MenuButton, MenuItems } from "@headlessui/react";
import { Button } from "../atoms/Button";
import { CanvasToolbarRunMenuItems } from "./CanvasToolbarRunMenuItems";
import type { CanvasToolbarRunMenuProps } from "../../types";

/** The Run button's split menu: rerun what failed, or resume from one failed step. */
export function CanvasToolbarRunMenu({
  isRunning,
  resumeOptions,
  isResumeLoading,
  onRerunFailed,
  onRunFromFailedNode,
}: CanvasToolbarRunMenuProps) {
  return (
    <Menu>
      {({ open }) => (
        <>
          <MenuButton
            as={Button}
            disabled={isRunning}
            // The title keeps the disabled trigger hoverable, so it can say
            // why it is unavailable (and show the wait cursor).
            title={isRunning ? "Available when the run finishes" : undefined}
            aria-label="Run options"
            intent={isRunning ? "warning" : "default"}
            size="sm"
            className={[
              "h-8 rounded-l-none rounded-r-xs px-2 transition-colors border-l border-surface-raised/30 dark:border-surface-dark-raised/30",
              isRunning ? "cursor-wait!" : "hover:brightness-110",
            ].join(" ")}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </MenuButton>

          <MenuItems
            anchor="bottom end"
            aria-label="Run options"
            className="z-50 min-w-[280px] max-w-[360px] overflow-hidden rounded-sm border border-border bg-surface-raised py-1 shadow-overlay focus:outline-hidden dark:border-border-dark dark:bg-surface-dark-raised"
          >
            <CanvasToolbarRunMenuItems
              isRunning={isRunning}
              resumeOptions={resumeOptions}
              isResumeLoading={isResumeLoading}
              onRerunFailed={onRerunFailed}
              onRunFromFailedNode={onRunFromFailedNode}
            />
          </MenuItems>
        </>
      )}
    </Menu>
  );
}
