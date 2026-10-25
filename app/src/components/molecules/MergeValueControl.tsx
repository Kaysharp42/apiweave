import { Suspense } from "react";
import { Input } from "../atoms/Input";
import { MonacoEditor } from "../node-modal/lazyMonaco";
import { useDarkMode } from "../../hooks/useDarkMode";
import type { MergeValueControlProps } from "../../types";

/**
 * A value being written: an inline input for a short value, Monaco for a long
 * one. A text value is edited as itself and stays text; anything else is
 * edited as JSON, so its type is explicit. Whatever does not parse is said
 * below the control, and the caller decides nothing on it.
 */
export function MergeValueControl({
  label,
  value,
  text,
  long,
  textValue,
  disabled,
  error,
  onChange,
}: MergeValueControlProps) {
  const isDarkMode = useDarkMode();
  return (
    <div className="space-y-1">
      {long ? (
        <div className="overflow-hidden rounded-sm border border-border dark:border-border-dark">
          <Suspense
            fallback={
              <div className="flex h-40 items-center justify-center text-xs text-text-secondary dark:text-text-secondary-dark">
                Loading editor…
              </div>
            }
          >
            <MonacoEditor
              height="160px"
              language={textValue ? "plaintext" : "json"}
              theme={isDarkMode ? "vs-dark" : "light"}
              value={text}
              onChange={(next) => onChange(next ?? "")}
              options={{
                minimap: { enabled: false },
                fontFamily: "JetBrains Mono",
                scrollBeyondLastLine: false,
                tabSize: 2,
                fixedOverflowWidgets: true,
                // See JsonBodyEditor: the EditContext input path drops keystrokes in this Electron build.
                editContext: false,
                ariaLabel: `Result for ${label}`,
              }}
            />
          </Suspense>
        </div>
      ) : (
        <Input
          size="sm"
          className="font-mono text-xs"
          value={text}
          disabled={disabled}
          placeholder={
            value === undefined ? "No value yet — type JSON to keep one" : undefined
          }
          aria-label={`Result for ${label}`}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error !== null && (
        <p
          role="alert"
          className="text-xxs text-status-error dark:text-[var(--aw-status-error)]"
        >
          {error}
        </p>
      )}
      {!long && !textValue && (
        <p className="text-xxs text-text-muted dark:text-text-muted-dark">
          JSON: text in quotes; numbers, true, false and null as they are.
        </p>
      )}
    </div>
  );
}
