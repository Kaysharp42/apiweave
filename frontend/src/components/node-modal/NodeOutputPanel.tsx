import { FileText } from 'lucide-react';
import type { NodeOutputPanelProps } from '../../types/NodeOutputPanelProps';

function CodeBlock({ value }: { value: unknown }) {
  return (
    <pre className="h-full w-full overflow-auto rounded-sm border border-border bg-surface-raised p-4 font-mono text-xs leading-relaxed text-text-secondary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-secondary-dark">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function NodeOutputPanel({ output }: NodeOutputPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface dark:bg-surface-dark">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-border bg-surface-overlay px-5 py-3 dark:border-border-dark dark:bg-surface-dark-overlay">
        <h3 className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wide text-text-primary dark:text-text-primary-dark">
          <FileText className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
          Node Output
        </h3>
      </div>

      {!output ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <FileText className="w-16 h-16 mx-auto mb-4 text-text-muted dark:text-text-muted-dark/70" />
            <p className="text-sm text-text-muted dark:text-text-muted-dark mb-2">
              Execute this node to view data
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden bg-surface p-4 dark:bg-surface-dark">
          <CodeBlock value={output} />
        </div>
      )}
    </div>
  );
}
