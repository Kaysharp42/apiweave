import { MOVE_DIALOG_SELECT_CLASS } from "./moveDialogClasses";
import type { Workspace } from "../../types";

interface WorkspaceSelectProps {
  readonly workspaces: readonly Workspace[];
  readonly value: string;
  readonly onChange: (workspaceId: string) => void;
  readonly disabled: boolean;
  /** The workspace the item currently lives in, when the list marks it. */
  readonly sourceWorkspaceId?: string;
  /** Suffix appended to the source workspace's name, e.g. " (same workspace)". */
  readonly sourceSuffix?: string;
}

/**
 * The destination-workspace `<select>` the move and duplicate dialogs share —
 * same aria label, same daisyUI + token pairing (see `moveDialogClasses`), so
 * the two destination pickers cannot drift apart.
 */
export function WorkspaceSelect({
  workspaces,
  value,
  onChange,
  disabled,
  sourceWorkspaceId,
  sourceSuffix = "",
}: WorkspaceSelectProps) {
  return (
    <select
      aria-label="Destination workspace"
      className={MOVE_DIALOG_SELECT_CLASS}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      {workspaces.map((workspace) => (
        <option key={workspace.workspaceId} value={workspace.workspaceId}>
          {workspace.name}
          {sourceWorkspaceId !== undefined &&
          workspace.workspaceId === sourceWorkspaceId
            ? sourceSuffix
            : ""}
        </option>
      ))}
    </select>
  );
}
