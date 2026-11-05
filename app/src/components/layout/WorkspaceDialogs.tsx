import { Suspense } from "react";
import { PromptDialog } from "../molecules/PromptDialog";
import useShortcutsHelpStore from "../../stores/ShortcutsHelpStore";
import { lazyNamed } from "../../utils/lazyNamed";
import type { WorkspaceDialogsProps } from "../../types";

const KeyboardShortcutsHelp = lazyNamed(
  () => import("../organisms/KeyboardShortcutsHelp"),
  "KeyboardShortcutsHelp",
);
const OpenWorkspaceFromGitModal = lazyNamed(
  () => import("../organisms/OpenWorkspaceFromGitModal"),
  "OpenWorkspaceFromGitModal",
);

/**
 * The workspace's own overlays: the new-workflow prompt, the shortcuts sheet
 * and the open-from-git dialog. None of them has a box of its own while closed,
 * so the workspace does not have to branch for each one.
 */
export function WorkspaceDialogs({
  showNewWorkflowPrompt,
  onCloseNewWorkflowPrompt,
  onCreateWorkflow,
  showOpenFromGit,
  onCloseOpenFromGit,
}: WorkspaceDialogsProps) {
  const shortcutsHelpOpen = useShortcutsHelpStore((state) => state.isOpen);
  const closeShortcutsHelp = useShortcutsHelpStore((state) => state.close);

  return (
    <>
      {shortcutsHelpOpen && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp open onClose={closeShortcutsHelp} />
        </Suspense>
      )}

      {showNewWorkflowPrompt && (
        <PromptDialog
          open={true}
          onClose={onCloseNewWorkflowPrompt}
          onSubmit={onCreateWorkflow}
          title="New Workflow"
          message="Enter a name for your workflow."
          placeholder="My Workflow"
          submitLabel="Create"
        />
      )}

      {showOpenFromGit && (
        <Suspense fallback={null}>
          <OpenWorkspaceFromGitModal isOpen onClose={onCloseOpenFromGit} />
        </Suspense>
      )}
    </>
  );
}
