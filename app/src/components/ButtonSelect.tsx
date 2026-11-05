import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Tooltip } from "./atoms/Tooltip";
import type { SelectOption, ButtonSelectProps } from "../types";

const EMPTY_OPTIONS: SelectOption[] = [];

export default function ButtonSelect({
  options = EMPTY_OPTIONS,
  value = "",
  onChange = () => {},
  placeholder = "Select",
  buttonClass = "",
  containerClass = "",
  icon,
  iconOnly = false,
}: ButtonSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);
  const selectedLabel = selected?.label ?? placeholder;

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((s) => !s)}
      className={["cursor-pointer", buttonClass].filter(Boolean).join(" ")}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={iconOnly ? selectedLabel : undefined}
    >
      {icon !== undefined && (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      {!iconOnly && <span className="truncate">{selectedLabel}</span>}
      {!iconOnly && <ChevronDown className="w-4 h-4 ml-2 shrink-0" />}
    </button>
  );

  return (
    <div
      ref={ref}
      className={["relative min-w-0", containerClass]
        .filter(Boolean)
        .join(" ")}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {iconOnly ? (
        <Tooltip content={selectedLabel}>{trigger}</Tooltip>
      ) : (
        trigger
      )}

      {open && (
        <ul
          className={[
            "absolute top-full z-50 mt-1 max-h-56 overflow-auto rounded-xs border border-border bg-surface-raised py-1 shadow-overlay dark:border-border-dark dark:bg-surface-dark-raised",
            iconOnly ? "right-0 w-56" : "inset-x-0 w-full",
          ].join(" ")}
          role="listbox"
        >
          {options.map((opt) => (
            <li key={opt.value} role="presentation">
              <button
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full cursor-pointer truncate px-3 py-2 text-left text-sm transition-colors ${
                  opt.value === value
                    ? "bg-primary/10 dark:bg-primary-light/10 text-primary dark:text-primary-light font-medium font-mono"
                    : "text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
                }`}
                role="option"
                aria-selected={opt.value === value}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
