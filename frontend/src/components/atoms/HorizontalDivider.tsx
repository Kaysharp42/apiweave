import type { HorizontalDividerProps } from "../../types";

export function HorizontalDivider({
  className = "",
  ...rest
}: HorizontalDividerProps) {
  return (
    <hr
      className={[
        "h-px w-full border-0 bg-border dark:bg-border-dark",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}
