import { ProjectOptions } from "../atoms/ProjectOptions";
import { Select } from "../atoms/Select";
import { Spinner } from "../atoms/Spinner";
import type { ProjectAssignmentSelectProps } from "../../types";

/** Choose the project a workflow belongs to, or none: the move dialogs' project field. */
export function ProjectAssignmentSelect({
  projects,
  isLoading,
  value,
  onChange,
  disabled,
  ariaLabel,
  unassignedValue,
}: ProjectAssignmentSelectProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-text-secondary dark:text-text-secondary-dark">
        <Spinner size="xs" /> Loading projects…
      </div>
    );
  }

  return (
    <Select
      aria-label={ariaLabel}
      className="cursor-pointer"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value={unassignedValue}>No project</option>
      <ProjectOptions projects={projects} />
    </Select>
  );
}
