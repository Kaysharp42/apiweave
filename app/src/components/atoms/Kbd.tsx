import type { KbdProps } from "../../types";

/** A single key hint. Shared so menus and rows spell the same chord the same way. */
export function Kbd({ children, className = "" }: KbdProps) {
  return (
    <kbd
      className={[
        "font-mono text-2xs leading-4 text-text-muted dark:text-text-muted-dark",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </kbd>
  );
}
