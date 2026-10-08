import { Check, X } from "lucide-react";
import { Badge } from "../atoms/Badge";
import type { ScriptOutcomesProps } from "../../types";

const PHASE_LABEL = { preRequest: "Pre-request script", postResponse: "Post-response script" } as const;

/** What a request's scripts did on the last run: their error, `aw.test` results and console output. */
export function ScriptOutcomes({ scripts }: ScriptOutcomesProps) {
  return (
    <div className="mb-3 max-h-48 space-y-3 overflow-y-auto rounded-sm border border-border bg-surface-raised p-3 dark:border-border-dark dark:bg-surface-dark-raised">
      {scripts.map((script) => {
        const failed = script.tests.filter((test) => !test.passed).length;
        return (
          <section key={script.phase} aria-label={PHASE_LABEL[script.phase]} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark">
                {PHASE_LABEL[script.phase]}
              </span>
              <Badge variant="outline" size="sm">
                {script.duration} ms
              </Badge>
              {script.tests.length > 0 && (
                <Badge variant={failed > 0 ? "error" : "success"} size="sm">
                  {script.tests.length - failed}/{script.tests.length} tests passed
                </Badge>
              )}
            </div>
            {script.error !== undefined && (
              <p className="font-mono text-xs text-status-error dark:text-status-error-dark">{script.error}</p>
            )}
            {script.tests.length > 0 && (
              <ul className="space-y-0.5">
                {script.tests.map((test, index) => (
                  <li key={`${test.name}-${index}`} className="flex items-start gap-1.5 text-xs">
                    {test.passed ? (
                      <Check className="mt-0.5 h-3 w-3 flex-shrink-0 text-status-success dark:text-status-success-dark" aria-label="passed" />
                    ) : (
                      <X className="mt-0.5 h-3 w-3 flex-shrink-0 text-status-error dark:text-status-error-dark" aria-label="failed" />
                    )}
                    <span className="text-text-primary dark:text-text-primary-dark">{test.name}</span>
                    {test.error !== undefined && (
                      <span className="font-mono text-text-secondary dark:text-text-secondary-dark">{test.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {script.logs.length > 0 && (
              <pre className="whitespace-pre-wrap break-all rounded-sm bg-surface-overlay p-2 font-mono text-[11px] text-text-secondary dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
                {script.logs.join("\n")}
              </pre>
            )}
          </section>
        );
      })}
    </div>
  );
}
