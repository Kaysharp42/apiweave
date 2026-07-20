import { useEffect, useMemo, useState } from "react";
import { JsonEditor } from "json-edit-react";
import { Braces, FileCode, FileText, type LucideIcon } from "lucide-react";
import { Button } from "../atoms/Button";
import { Card } from "../molecules/Card";
import { EmptyState } from "../molecules/EmptyState";
import { StatusBadge } from "../molecules/StatusBadge";
import type { StatusBadgeProps } from "../../types";
import type { NodeOutputPanelProps } from "../../types/NodeOutputPanelProps";

type NodeOutputTab = "tree" | "raw";

function isEmptyOutput(output: unknown | null): boolean {
  return output === null || output === undefined || output === "";
}

function isTreeOutput(
  output: unknown,
): output is Record<string, unknown> | unknown[] {
  return typeof output === "object" && output !== null;
}

function stringifyOutput(output: unknown): string {
  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

function createCardIcon(Icon: LucideIcon) {
  return function CardIcon({ className }: { className?: string }) {
    return <Icon className={className} />;
  };
}

function normalizeStatus(status: string): StatusBadgeProps["status"] {
  if (
    status === "running" ||
    status === "success" ||
    status === "error" ||
    status === "warning" ||
    status === "info"
  )
    return status;
  return "idle";
}

const BracesCardIcon = createCardIcon(Braces);
const FileCodeCardIcon = createCardIcon(FileCode);

export function NodeOutputPanel({
  output,
  executionStatus = "idle",
}: NodeOutputPanelProps) {
  const [activeTab, setActiveTab] = useState<NodeOutputTab>("tree");
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      return document.documentElement.classList.contains("dark");
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    const syncDarkMode = () => setIsDarkMode(root.classList.contains("dark"));
    const observer = new MutationObserver(syncDarkMode);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const jsonEditorTheme = useMemo(() => {
    if (!isDarkMode) return undefined;
    return {
      container: {
        backgroundColor: "var(--color-surface-dark-raised)",
        color: "var(--color-text-primary-dark)",
      },
      collection: { backgroundColor: "transparent" },
      collectionInner: { backgroundColor: "transparent" },
      collectionElement: { backgroundColor: "transparent" },
      property: { color: "var(--color-text-primary-dark)" },
      bracket: { color: "var(--color-text-secondary-dark)" },
      itemCount: { color: "var(--color-text-muted-dark)" },
      iconCollection: { color: "var(--aw-primary)" },
      string: { color: "var(--color-success)" },
      number: { color: "var(--color-info)" },
      boolean: { color: "var(--color-primary-dark)" },
      null: { color: "var(--color-warning)" },
      input: {
        backgroundColor: "var(--color-surface-dark-overlay)",
        color: "var(--color-text-primary-dark)",
        border: "1px solid var(--color-border-dark)",
      },
      inputHighlight: { backgroundColor: "var(--color-surface-dark-overlay)" },
      error: { color: "var(--color-error)" },
    } as const;
  }, [isDarkMode]);

  const showTree =
    activeTab === "tree" && !isEmptyOutput(output) && isTreeOutput(output);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface dark:bg-surface-dark">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-raised px-4 py-3 dark:border-border-dark dark:bg-surface-dark-raised">
        <div className="flex min-w-0 items-center gap-2">
          <FileText
            className="h-4 w-4 text-text-muted dark:text-text-muted-dark"
            aria-hidden="true"
          />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-text-primary dark:text-text-primary-dark">
            Node Output
          </h3>
        </div>
        <StatusBadge status={normalizeStatus(executionStatus)} size="sm" />
      </div>

      {isEmptyOutput(output) ? (
        <div className="flex min-h-0 flex-1 items-center justify-center bg-surface p-6 dark:bg-surface-dark">
          <EmptyState
            icon={
              <FileText
                className="h-12 w-12 text-text-muted dark:text-text-muted-dark"
                strokeWidth={1.5}
              />
            }
            title="No output yet"
            description="Run the workflow to see results here."
            className="min-h-40 py-8"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-surface p-4 dark:bg-surface-dark">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={activeTab === "tree" ? "primary" : "secondary"}
              size="xs"
              onClick={() => setActiveTab("tree")}
              disabled={!isTreeOutput(output)}
            >
              <Braces className="h-3.5 w-3.5" aria-hidden="true" />
              Tree
            </Button>
            <Button
              variant={activeTab === "raw" ? "primary" : "secondary"}
              size="xs"
              onClick={() => setActiveTab("raw")}
            >
              <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
              Raw
            </Button>
          </div>

          {showTree ? (
            <Card
              title="Output tree"
              icon={BracesCardIcon}
              className="flex min-h-0 flex-1 flex-col [&>:last-child]:min-h-0 [&>:last-child]:flex-1"
            >
              <div className="h-full overflow-auto rounded-sm border border-border bg-surface-raised p-3 dark:border-border-dark dark:bg-surface-dark-raised">
                <JsonEditor
                  data={output}
                  restrictEdit={true}
                  restrictAdd={true}
                  restrictDelete={true}
                  rootName="output"
                  {...(jsonEditorTheme ? { theme: jsonEditorTheme } : {})}
                />
              </div>
            </Card>
          ) : (
            <Card
              title="Raw output"
              icon={FileCodeCardIcon}
              className="flex min-h-0 flex-1 flex-col [&>:last-child]:min-h-0 [&>:last-child]:flex-1"
            >
              <pre className="h-full overflow-auto rounded-sm border border-border bg-surface-overlay p-3 font-mono text-xs leading-relaxed text-text-primary whitespace-pre-wrap break-words dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-primary-dark">
                {stringifyOutput(output)}
              </pre>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
