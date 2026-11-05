import type { ChangeEvent } from "react";
import type { ProjectImportTargetSelectProps } from "../../types";
import { Select } from "../atoms/Select";

/** The "Select Project" control shared by the project import tabs. */
export function ProjectImportTargetSelect({
  id,
  value,
  onChange,
  projects,
}: ProjectImportTargetSelectProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    onChange(event.target.value || null);
  };

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-sm font-medium text-text-primary dark:text-text-primary-dark"
      >
        Select Project
      </label>
      <Select id={id} value={value ?? ""} onChange={handleChange}>
        <option value="">-- Choose a project --</option>
        {projects.map((project) => (
          <option
            key={project.projectId ?? project.collectionId}
            value={project.projectId ?? project.collectionId}
          >
            {project.name} ({project.workflowCount} workflows)
          </option>
        ))}
      </Select>
      {projects.length === 0 && (
        <p className="text-xs text-(--aw-status-warning)">
          No projects available. Create a project first.
        </p>
      )}
    </div>
  );
}
