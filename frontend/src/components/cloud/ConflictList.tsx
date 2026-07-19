import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../atoms/Button";
import { Badge } from "../atoms/Badge";
import { invoke } from "../../utils/apiweaveClient";
import type { ConflictListItem } from "../../types/cloud";

const POLL_MS = 10_000;

export function ConflictList() {
  const navigate = useNavigate();
  const [conflicts, setConflicts] = useState<readonly ConflictListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const items = await invoke<readonly ConflictListItem[]>(
        "cloud",
        "conflict-list",
        { resolved: false },
      );
      setConflicts(items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conflicts");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (conflicts.length === 0 && error === null) return null;

  return (
    <section className="rounded-sm border border-status-warning/30 bg-status-warning/10 p-4 dark:border-[var(--aw-status-warning)]/30 dark:bg-[var(--aw-status-warning)]/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-warning dark:text-[var(--aw-status-warning)]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
              {conflicts.length} unresolved sync conflict
              {conflicts.length === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
              Pick the local or cloud copy for each whole record.
            </p>
          </div>
        </div>
        {error && <Badge variant="error">{error}</Badge>}
      </div>

      {conflicts.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-sm border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
          <table className="min-w-full divide-y divide-border text-sm dark:divide-border-dark">
            <thead className="bg-surface-overlay dark:bg-surface-dark-overlay">
              <tr className="text-left text-xs font-medium text-text-secondary dark:text-text-secondary-dark">
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Record</th>
                <th className="px-3 py-2">Local rev</th>
                <th className="px-3 py-2">Cloud rev</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-border-dark">
              {conflicts.map((conflict) => (
                <tr key={conflict.id}>
                  <td className="px-3 py-2">
                    <Badge variant="warning" size="sm">{conflict.kind}</Badge>
                  </td>
                  <td className="px-3 py-2 text-text-primary dark:text-text-primary-dark">
                    {conflict.name ?? (
                      <span className="font-mono text-xs">{conflict.record_id}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-text-secondary dark:text-text-secondary-dark">
                    {conflict.local_rev}
                  </td>
                  <td className="px-3 py-2 text-text-secondary dark:text-text-secondary-dark">
                    {conflict.cloud_rev}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/cloud/conflicts/${conflict.id}`)}
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
