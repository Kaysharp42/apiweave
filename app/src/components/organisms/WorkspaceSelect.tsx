import { Select } from "../atoms/Select";
import type { WorkspaceSelectProps } from "../../types";

/**
 * The destination-workspace picker the move and duplicate dialogs share: same
 * accessible name, same `Select` atom, so the two cannot drift apart.
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
    <Select
      aria-label="Destination workspace"
      className="cursor-pointer"
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
    </Select>
  );
}
