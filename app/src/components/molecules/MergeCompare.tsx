import { Suspense } from "react";
import type { JsonValue } from "@shared/types/JsonValue";
import { MonacoDiffEditor } from "../node-modal/lazyMonaco";
import { useDarkMode } from "../../hooks/useDarkMode";
import type { MergeCompareProps } from "../../types";

/** What one side's value reads as in the diff: text as itself, everything else as indented JSON. */
function compareText(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/** Both copies of one value side by side, read-only: the way to see what differs in a long body or script before deciding. */
export function MergeCompare({ label, ours, theirs }: MergeCompareProps) {
  const isDarkMode = useDarkMode();
  const text = typeof ours === "string" && typeof theirs === "string";
  return (
    <div className="overflow-hidden rounded-sm border border-border dark:border-border-dark">
      <Suspense
        fallback={
          <div className="flex h-48 items-center justify-center text-xs text-text-secondary dark:text-text-secondary-dark">
            Loading editor…
          </div>
        }
      >
        <MonacoDiffEditor
          height="220px"
          language={text ? "plaintext" : "json"}
          theme={isDarkMode ? "vs-dark" : "light"}
          original={compareText(ours)}
          modified={compareText(theirs)}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            renderSideBySide: true,
            scrollBeyondLastLine: false,
            fontFamily: "JetBrains Mono",
            fixedOverflowWidgets: true,
            editContext: false,
            ariaLabel: `Compare your copy with the remote copy of ${label}`,
          }}
        />
      </Suspense>
    </div>
  );
}
