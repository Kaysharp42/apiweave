import type { ReactNode } from "react";

interface DetailFieldProps {
  readonly label: string;
  readonly children: ReactNode;
  /** Values that are referenced verbatim (key names, key ids) render as code. */
  readonly mono?: boolean;
  /** Extra classes for long unbreakable values such as key ids. */
  readonly breakAll?: boolean;
}

/** One label-over-value row of the selected-item details card. */
export function DetailField({ label, children, mono, breakAll }: DetailFieldProps) {
  return (
    <div>
      <span className="text-xs text-text-muted dark:text-text-muted-dark">
        {label}
      </span>
      <p
        className={[
          "text-sm text-text-primary dark:text-text-primary-dark",
          mono ? "font-mono" : "",
          breakAll ? "break-all" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </p>
    </div>
  );
}
