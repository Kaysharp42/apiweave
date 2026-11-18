import type { ValueViolationsProps } from "../../types/ValueViolationsProps";

/** Each place a node's value broke a schema or snapshot rule: its path (or `(root)`) and why. */
export function ValueViolations({ label, violations, className = "" }: ValueViolationsProps) {
  if (violations.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className={`max-h-48 space-y-0.5 overflow-y-auto rounded-xs border border-border bg-surface-raised p-3 font-mono text-xs dark:border-border-dark dark:bg-surface-dark-raised ${className}`}
    >
      {violations.map((violation, index) => (
        <li key={index} className="text-text-primary dark:text-text-primary-dark">
          <span className="text-status-error">{violation.path === "" ? "(root)" : violation.path}</span>{" "}
          {violation.message}
        </li>
      ))}
    </ul>
  );
}
