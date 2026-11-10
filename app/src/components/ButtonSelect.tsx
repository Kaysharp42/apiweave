import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";
import { Tooltip } from "./atoms/Tooltip";
import type { SelectOption, ButtonSelectProps } from "../types";

const EMPTY_OPTIONS: SelectOption[] = [];

const FOCUS_RING_CLASS =
  "focus-visible:outline-2 focus-visible:outline-(--aw-primary) focus-visible:outline-offset-(--aw-focus-ring-offset)";

const OPTION_CLASS = [
  "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none",
  "text-text-primary dark:text-text-primary-dark",
  // The active option is the one the arrow keys or the pointer are on.
  "data-focus:bg-surface-overlay dark:data-focus:bg-surface-dark-overlay",
  "data-selected:bg-primary/10 dark:data-selected:bg-primary-light/10 data-selected:text-primary dark:data-selected:text-primary-light data-selected:font-medium",
  "data-focus:outline-2 data-focus:-outline-offset-2 data-focus:outline-(--aw-primary)",
].join(" ");

/**
 * A compact single-select on Headless UI's Listbox: arrow keys, Home/End and
 * type-ahead move through the options, Enter or Space picks one, and Escape
 * closes the list and returns focus to the trigger.
 *
 * The list is rendered in place (not portalled) so it stays inside the dialog
 * that owns it.
 */
// fallow-ignore-next-line complexity -- the CRAP estimate is a coverage artifact; ButtonSelect.test.tsx covers selection, the icon-only trigger and the labelled trigger.
export default function ButtonSelect({
  options = EMPTY_OPTIONS,
  value = "",
  onChange = () => {},
  placeholder = "Select",
  label,
  buttonClass = "",
  containerClass = "",
  icon,
  iconOnly = false,
}: ButtonSelectProps) {
  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? placeholder;
  const accessibleName =
    label !== undefined ? `${label}: ${selectedLabel}` : selectedLabel;

  const trigger = (
    <ListboxButton
      className={["cursor-pointer", FOCUS_RING_CLASS, buttonClass]
        .filter(Boolean)
        .join(" ")}
      aria-label={iconOnly || label !== undefined ? accessibleName : undefined}
    >
      {icon !== undefined && (
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      {!iconOnly && <span className="truncate">{selectedLabel}</span>}
      {!iconOnly && (
        <ChevronDown className="w-4 h-4 ml-2 shrink-0" aria-hidden="true" />
      )}
    </ListboxButton>
  );

  return (
    <Listbox
      as="div"
      value={value}
      onChange={onChange}
      className={["relative min-w-0", containerClass].filter(Boolean).join(" ")}
    >
      {iconOnly ? (
        <Tooltip content={accessibleName}>{trigger}</Tooltip>
      ) : (
        trigger
      )}

      <ListboxOptions
        aria-label={label}
        className={[
          "absolute top-full z-50 mt-1 max-h-56 overflow-auto rounded-sm border border-border bg-surface-raised py-1 shadow-overlay focus:outline-hidden dark:border-border-dark dark:bg-surface-dark-raised",
          iconOnly ? "right-0 w-56" : "inset-x-0 w-full",
        ].join(" ")}
      >
        {options.map((opt) => (
          <ListboxOption key={opt.value} value={opt.value} className={OPTION_CLASS}>
            {({ selected }) => (
              <>
                <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                {selected && (
                  <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
              </>
            )}
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}
