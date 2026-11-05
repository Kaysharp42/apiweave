import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Tooltip } from "./atoms/Tooltip";
import type { SelectOption, ButtonSelectProps } from "../types";

const EMPTY_OPTIONS: SelectOption[] = [];

const OPTION_CLASS =
  "w-full cursor-pointer truncate px-3 py-2 text-left text-sm transition-colors";

function optionClass(selected: boolean): string {
  return selected
    ? `${OPTION_CLASS} bg-primary/10 dark:bg-primary-light/10 text-primary dark:text-primary-light font-medium font-mono`
    : `${OPTION_CLASS} text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay`;
}

function Trigger({
  open,
  label,
  buttonClass,
  icon,
  iconOnly,
  onToggle,
}: {
  readonly open: boolean;
  readonly label: string;
  readonly buttonClass: string;
  readonly icon: ReactNode;
  readonly iconOnly: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={["cursor-pointer", buttonClass].filter(Boolean).join(" ")}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={iconOnly ? label : undefined}
    >
      {icon !== undefined && (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      {!iconOnly && <span className="truncate">{label}</span>}
      {!iconOnly && <ChevronDown className="w-4 h-4 ml-2 shrink-0" />}
    </button>
  );
}

function OptionList({
  options,
  value,
  iconOnly,
  onSelect,
}: {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly iconOnly: boolean;
  readonly onSelect: (value: string) => void;
}) {
  return (
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
            onClick={() => onSelect(opt.value)}
            className={optionClass(opt.value === value)}
            role="option"
            aria-selected={opt.value === value}
          >
            {opt.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

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

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  const trigger = (
    <Trigger
      open={open}
      label={selectedLabel}
      buttonClass={buttonClass}
      icon={icon}
      iconOnly={iconOnly}
      onToggle={() => setOpen((s) => !s)}
    />
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
        <OptionList
          options={options}
          value={value}
          iconOnly={iconOnly}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
