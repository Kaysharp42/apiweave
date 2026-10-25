import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { Button } from "../atoms/Button";
import { GitSyncKindIcon } from "../molecules/GitSyncKindIcon";
import { GitSyncDialogs } from "../organisms/GitSyncDialogs";
import { GitSyncStatusCard } from "../organisms/GitSyncStatusCard";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useGitSyncActions } from "../../hooks/useGitSyncActions";
import { describeGitSync } from "../../utils/gitSync";
import { noDragStyle } from "./WindowControls";
import type { GitSyncControlProps, TrackedGitSyncControlProps } from "../../types";

function TrackedGitSyncControl({
  status,
  apply,
  settingsPath,
}: TrackedGitSyncControlProps) {
  const actions = useGitSyncActions(status, apply);
  const view = describeGitSync(status);

  return (
    <>
      <Popover className="relative">
        {({ close }) => (
          <>
            <PopoverButton
              as={Button}
              variant="outline"
              intent={view.intent}
              size="sm"
              className="h-9"
              aria-label={`Version history: ${view.label}`}
              icon={<GitSyncKindIcon indicator={view} />}
            >
              <span className="hidden sm:inline">{view.label}</span>
            </PopoverButton>
            <PopoverPanel
              anchor={{ to: "bottom end", gap: 6, padding: 8 }}
              className="z-50 w-80 rounded border border-border bg-surface-raised p-3 shadow-overlay focus:outline-none dark:border-border-dark dark:bg-surface-dark-raised"
            >
              <GitSyncStatusCard
                status={status}
                actions={actions}
                settingsPath={settingsPath}
                onNavigate={close}
              />
            </PopoverPanel>
          </>
        )}
      </Popover>
      <GitSyncDialogs status={status} actions={actions} />
    </>
  );
}

/**
 * The header's sync status: one icon and word for where the current
 * workspace's history stands, and a popover that explains it and offers what
 * to do. Absent for a workspace that is not tracked — there is nothing to
 * report — and when there is no bridge to ask (the browser build). `feed` is
 * the current workspace's, which the header reads once for every control in it.
 */
export function GitSyncControl({ feed }: GitSyncControlProps) {
  const { currentOrg, currentWorkspace } = useWorkspace();
  const { status, apply } = feed;
  if (status === null || !status.tracked || currentWorkspace === null) return null;

  return (
    <div style={noDragStyle}>
      {/* Keyed by workspace: what one workspace's actions were doing (busy, a failure) is not the next one's. */}
      <TrackedGitSyncControl
        key={status.workspaceId}
        status={status}
        apply={apply}
        settingsPath={`/${currentOrg?.slug ?? "personal"}/${currentWorkspace.slug}/settings/version-history`}
      />
    </div>
  );
}
