import type { BranchOptionsProps } from "../../types";

/** A remote's branch names, as the options of a branch `Select`. */
export function BranchOptions({ names }: BranchOptionsProps) {
  return (
    <>
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </>
  );
}
