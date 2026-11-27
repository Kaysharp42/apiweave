import type { ProjectOptionsProps } from "../../types";

/** One `<option>` per project, valued by its `collectionId`, for a project `<Select>`. */
export function ProjectOptions({ projects }: ProjectOptionsProps) {
  return (
    <>
      {projects.map((project) => (
        <option key={project.collectionId} value={project.collectionId}>
          {project.name}
        </option>
      ))}
    </>
  );
}
