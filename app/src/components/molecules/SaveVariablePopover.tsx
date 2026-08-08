import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { isValidVariableName } from "../../utils/extractorVariableName";
import type { SaveVariablePopoverProps } from "../../types";

const POPOVER_WIDTH = 288;
const VIEWPORT_MARGIN = 8;

/**
 * Names the variable for a value picked out of the response tree.
 *
 * Anchored to the row that was clicked and rendered in a portal so it escapes
 * the tree's scroll container, which would otherwise clip it.
 */
export function SaveVariablePopover({
  anchorRect,
  path,
  valuePreview,
  initialName,
  existingNames,
  onSave,
  onCancel,
}: SaveVariablePopoverProps) {
  const [name, setName] = useState(initialName);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [position, setPosition] = useState({
    top: anchorRect.bottom + 6,
    left: anchorRect.left,
  });

  useLayoutEffect(() => {
    const height = containerRef.current?.offsetHeight ?? 0;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, anchorRect.left - POPOVER_WIDTH / 2),
      window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
    );
    const fitsBelow =
      anchorRect.bottom + 6 + height <= window.innerHeight - VIEWPORT_MARGIN;
    setPosition({
      top: fitsBelow ? anchorRect.bottom + 6 : anchorRect.top - height - 6,
      left,
    });
  }, [anchorRect]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onCancel();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCancel();
      }
    };

    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onCancel]);

  const trimmedName = name.trim();
  const error =
    trimmedName === ""
      ? "Give the variable a name."
      : isValidVariableName(trimmedName)
        ? undefined
        : "Use letters, digits and underscores, starting with a letter.";
  const overwrites = !error && existingNames.includes(trimmedName);

  const submit = () => {
    if (error) return;
    onSave(trimmedName);
  };

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Save response value as variable"
      style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
      className="fixed z-[60] rounded-sm border border-border bg-surface-raised p-3 shadow-[var(--aw-shadow-popover)] dark:border-border-dark dark:bg-surface-dark-raised"
    >
      <p className="mb-2 truncate font-mono text-[11px] text-status-info dark:text-status-info-dark">
        {path}
      </p>
      <Input
        ref={inputRef}
        size="sm"
        label="Variable name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        aria-label="Variable name"
        className="font-mono"
        {...(error ? { error } : {})}
        {...(!error && overwrites
          ? { helperText: `Replaces the existing "${trimmedName}".` }
          : {})}
      />
      <p className="mt-2 truncate font-mono text-[11px] text-text-muted dark:text-text-muted-dark">
        Value {valuePreview}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="xs" onClick={submit} disabled={!!error}>
          {overwrites ? "Replace" : "Save"}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
