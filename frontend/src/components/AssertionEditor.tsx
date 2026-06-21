import { useEffect, useRef, useState } from "react";
import { Button } from "./atoms/Button";
import type { AssertionEditorProps } from "../types";

export default function AssertionEditor({
  value,
  onChange,
  onCancel,
  onSave,
}: AssertionEditorProps) {
  const local = value ?? {
    source: "prev",
    path: "",
    operator: "equals",
    expectedValue: "",
  };
  const { source, path, operator, expectedValue } = local;
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<{ path: string; expectedValue: string }>(
    { path: "", expectedValue: "" },
  );

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const validate = (): boolean => {
    const next = { path: "", expectedValue: "" };
    if (source !== "status") {
      if (["exists", "notExists"].includes(operator)) {
        if (!path || !path.trim()) next.path = "Path is required";
      } else {
        if (!path || !path.trim()) next.path = "Path is required";
        if (!expectedValue || !expectedValue.toString().trim())
          next.expectedValue = "Expected value is required";
      }
    }
    setErrors(next);
    return !next.path && !next.expectedValue;
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      if (validate()) onSave();
    }
  };

  const handleSave = () => {
    if (validate()) onSave();
  };

  return (
    <form className="space-y-2" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={source}
          onChange={(e) => onChange({ ...local, source: e.target.value })}
          onKeyDown={handleKey}
          aria-label="Assertion source"
          className="w-full px-2 py-1 text-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark rounded focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        >
          <option value="prev">prev</option>
          <option value="variables">variables</option>
          <option value="status">status</option>
          <option value="cookies">cookies</option>
          <option value="headers">headers</option>
        </select>
        <div>
          <input
            ref={inputRef}
            type="text"
            value={path}
            onChange={(e) => onChange({ ...local, path: e.target.value })}
            onKeyDown={handleKey}
            placeholder="path or name"
            aria-label="Assertion path or name"
            className={`w-full px-2 py-1 text-sm border rounded font-mono bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${errors.path ? "border-status-error dark:border-[var(--aw-status-error)]" : "border-border dark:border-border-dark"}`}
          />
          {errors.path && (
            <div className="text-[11px] text-status-error dark:text-[var(--aw-status-error)] mt-1">
              {errors.path}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={operator}
          onChange={(e) => onChange({ ...local, operator: e.target.value })}
          onKeyDown={handleKey}
          aria-label="Assertion operator"
          className="w-full px-2 py-1 text-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark rounded focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
        >
          <option value="equals">Equals (==)</option>
          <option value="notEquals">Not Equals (!=)</option>
          <option value="contains">Contains</option>
          <option value="notContains">Does Not Contain</option>
          <option value="gt">Greater Than (&gt;)</option>
          <option value="gte">Greater Than or Equal (&gt;=)</option>
          <option value="lt">Less Than (&lt;)</option>
          <option value="lte">Less Than or Equal (&lt;=)</option>
          <option value="count">Count (array length)</option>
          <option value="exists">Exists</option>
          <option value="notExists">Does Not Exist</option>
        </select>

        {!["exists", "notExists"].includes(operator) ? (
          <div>
            <input
              type="text"
              value={expectedValue}
              onChange={(e) =>
                onChange({ ...local, expectedValue: e.target.value })
              }
              onKeyDown={handleKey}
              placeholder="expected value"
              aria-label="Assertion expected value"
              className={`w-full px-2 py-1 text-sm border rounded font-mono bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] ${errors.expectedValue ? "border-status-error dark:border-[var(--aw-status-error)]" : "border-border dark:border-border-dark"}`}
            />
            {errors.expectedValue && (
              <div className="text-[11px] text-status-error dark:text-[var(--aw-status-error)] mt-1">
                {errors.expectedValue}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-text-muted dark:text-text-muted-dark flex items-center px-2">
            No value required
          </div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="primary" size="xs" onClick={handleSave}>
          Save
        </Button>
      </div>
    </form>
  );
}
