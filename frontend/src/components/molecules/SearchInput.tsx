import { useId } from "react";
import { Search, X } from "lucide-react";
import type { SearchInputProps } from "../../types";

export function SearchInput({
  value = "",
  onChange,
  placeholder = "Search…",
  size = "sm",
  className = "",
  autoFocus = false,
  ...rest
}: SearchInputProps) {
  const id = useId();

  const sizeClass: Record<string, string> = {
    xs: "h-7 text-xs",
    sm: "h-8 text-sm",
    md: "h-10 text-sm",
  };

  const iconSize: Record<string, string> = {
    xs: "w-3 h-3",
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
  };

  return (
    <div className={["relative w-full", className].filter(Boolean).join(" ")}>
      <Search
        className={[
          iconSize[size] ?? "w-3.5 h-3.5",
          "absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark pointer-events-none",
        ].join(" ")}
      />

      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={[
          "w-full rounded-sm border border-border pl-8 pr-7 transition-[border-color,outline] duration-[var(--aw-transition-fast)]",
          sizeClass[size] ?? "h-8 text-sm",
          "bg-surface-raised dark:bg-surface-dark-raised",
          "text-text-primary dark:text-text-primary-dark",
          "placeholder:text-text-muted dark:placeholder:text-text-muted-dark",
          "focus:border-primary focus:outline-none dark:focus:border-primary-light",
          "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
        ].join(" ")}
        {...rest}
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-sm p-0.5 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-text-muted-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
          aria-label="Clear search"
        >
          <X className={iconSize[size] ?? "w-3.5 h-3.5"} />
        </button>
      )}
    </div>
  );
}
