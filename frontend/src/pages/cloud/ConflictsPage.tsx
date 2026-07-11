import { useCallback, useEffect, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../components/atoms/Badge";
import { Button } from "../../components/atoms/Button";
import { Modal } from "../../components/molecules/Modal";
import { EmptyState } from "../../components/molecules/EmptyState";
import { ConflictList } from "../../components/cloud/ConflictList";
import { invoke } from "../../utils/apiweaveClient";
import type { ConflictListItem, ConflictPayload } from "../../types/cloud";

export function ConflictsPage() {
  const [resolved, setResolved] = useState<readonly ConflictListItem[]>([]);
  const [loser, setLoser] = useState<ConflictPayload | null>(null);
  const [loadingLoser, setLoadingLoser] = useState(false);

  const loadResolved = useCallback(async () => {
    try {
      setResolved(
        await invoke<readonly ConflictListItem[]>("cloud", "conflict-list", {
          resolved: true,
          since_days: 30,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load conflicts");
    }
  }, []);

  useEffect(() => {
    void loadResolved();
  }, [loadResolved]);

  async function openLoser(conflictId: string): Promise<void> {
    setLoadingLoser(true);
    try {
      setLoser(
        await invoke<ConflictPayload>("cloud", "conflict-fetch-loser", {
          conflict_id: conflictId,
        }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load rejected copy");
    } finally {
      setLoadingLoser(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-surface dark:bg-surface-dark">
      <div className="border-b border-border px-6 py-6 dark:border-border-dark">
        <div className="flex items-center gap-3">
          <GitCompareArrows className="h-5 w-5 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />
          <div>
            <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              Sync conflicts
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Resolve whole-record conflicts and inspect rejected copies from the last 30 days.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <ConflictList />

        <section className="rounded-sm border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised">
          <div className="border-b border-border px-4 py-3 dark:border-border-dark">
            <h2 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark">
              Resolved in the last 30 days
            </h2>
          </div>
          {resolved.length === 0 ? (
            <EmptyState
              icon={<GitCompareArrows className="h-12 w-12 text-text-muted" strokeWidth={1.5} />}
              title="No resolved conflicts"
              description="Rejected copies appear here after you resolve a conflict."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm dark:divide-border-dark">
                <thead className="bg-surface-overlay dark:bg-surface-dark-overlay">
                  <tr className="text-left text-xs font-medium text-text-secondary dark:text-text-secondary-dark">
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Record</th>
                    <th className="px-3 py-2">Winner</th>
                    <th className="px-3 py-2">Resolved</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border dark:divide-border-dark">
                  {resolved.map((conflict) => (
                    <tr key={conflict.id}>
                      <td className="px-3 py-2"><Badge variant="secondary">{conflict.kind}</Badge></td>
                      <td className="px-3 py-2 font-mono text-xs">{conflict.record_id}</td>
                      <td className="px-3 py-2"><Badge variant="success">{conflict.winner}</Badge></td>
                      <td className="px-3 py-2 text-text-secondary dark:text-text-secondary-dark">
                        {conflict.resolved_at ?? conflict.created_at}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={loadingLoser}
                          onClick={() => void openLoser(conflict.id)}
                        >
                          View rejected
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Modal
        isOpen={loser !== null}
        onClose={() => setLoser(null)}
        title="Rejected copy"
        size="xl"
      >
        <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs text-text-primary dark:text-text-primary-dark">
          {JSON.stringify(loser, null, 2)}
        </pre>
      </Modal>
    </div>
  );
}
