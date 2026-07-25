import { ArrowDownToLine, ArrowUpFromLine, GitBranch } from "lucide-react";
import { Modal } from "./Modal";
import { EmptyState } from "./EmptyState";
import { Badge } from "../atoms/Badge";
import type { VariableProvenanceModalProps } from "../../types";

export function VariableProvenanceModal({
  isOpen,
  onClose,
  variableName,
  provenance,
}: VariableProvenanceModalProps) {
  const producers = provenance?.producers ?? [];
  const consumers = provenance?.consumers ?? [];
  const isManual = producers.length === 0 && consumers.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Provenance: {{variables.${variableName}}}`}
      size="md"
    >
      <div className="p-5 space-y-4">
        {isManual ? (
          <EmptyState
            icon={<GitBranch className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
            title="Manual variable"
            description="This variable is defined by hand. No node produces or consumes it on the canvas."
          />
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
                <ArrowUpFromLine className="w-3.5 h-3.5" />
                Produced by
              </div>
              {producers.length === 0 ? (
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  No extractor on the canvas defines this variable (manual variable).
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {producers.map((p) => (
                    <li
                      key={`${p.nodeId}:${p.path}`}
                      className="flex flex-col gap-1 rounded border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-2"
                    >
                      <Badge variant="primary" size="sm" className="self-start" title={p.nodeId}>
                        {p.nodeLabel}
                      </Badge>
                      <code className="font-mono text-xs text-text-secondary dark:text-text-secondary-dark break-all">
                        {p.path}
                      </code>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
                <ArrowDownToLine className="w-3.5 h-3.5" />
                Consumed by
              </div>
              {consumers.length === 0 ? (
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  No node on the canvas references this variable yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {consumers.map((c) => (
                    <li
                      key={c.nodeId}
                      className="flex flex-wrap items-center gap-1.5 rounded border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-2"
                    >
                      <Badge variant="secondary" size="sm" title={c.nodeId}>
                        {c.nodeLabel}
                      </Badge>
                      <span className="text-[10px] text-text-muted dark:text-text-muted-dark">in</span>
                      {c.fields.map((f) => (
                        <Badge key={f} variant="outline" size="xs">
                          <code className="font-mono">{f}</code>
                        </Badge>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}