import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { Webhook } from "../types/Webhook";
import type { WebhookRun } from "../types/WebhookRun";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { webhookLogsUrl } from "../utils/apiweaveClient";

interface UseWebhookRunsResult {
  triggerTestDelivery: (webhook: Webhook) => Promise<void>;
  fetchWebhookRuns: (webhookId: string) => Promise<WebhookRun[]>;
  lastRunId: string | null;
  isTriggering: boolean;
  runs: WebhookRun[];
}

export function useWebhookRuns(): UseWebhookRunsResult {
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [runs, setRuns] = useState<WebhookRun[]>([]);

  const triggerTestDelivery = useCallback(async (webhook: Webhook) => {
    setIsTriggering(true);
    try {
      const executeUrl = webhook.url;
      const samplePayload = {
        test: true,
        triggeredFrom: "ui",
        timestamp: new Date().toISOString(),
      };

      const res = await authenticatedFetch(executeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(samplePayload),
      });

      if (res.ok) {
        const data = (await res.json()) as { runId: string; status?: string };
        setLastRunId(data.runId);
        toast.success(`Test delivery triggered. Run ID: ${data.runId}`);

        // Refresh runs list
        await fetchWebhookRuns(webhook.webhookId);
      } else {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        toast.error(
          `Test delivery failed: ${(err as { detail?: string }).detail || "Unknown error"}`,
        );
      }
    } catch (e) {
      console.error("Error triggering test delivery:", e);
      toast.error("Error triggering test delivery");
    } finally {
      setIsTriggering(false);
    }
  }, []);

  const fetchWebhookRuns = useCallback(
    async (webhookId: string): Promise<WebhookRun[]> => {
      try {
        const res = await authenticatedFetch(webhookLogsUrl(webhookId), {
          headers: { "Content-Type": "application/json" },
        });

        if (res.ok) {
          const data = (await res.json()) as {
            logs?: Array<{
              logId: string;
              runId?: string;
              status: string;
              timestamp?: string;
              duration?: number;
            }>;
          };

          const webhookRuns: WebhookRun[] = (data.logs || [])
            .filter((log) => log.runId)
            .map((log) => ({
              id: log.logId,
              runId: log.runId!,
              status: mapLogStatusToRunStatus(log.status),
              triggeredAt: log.timestamp || new Date().toISOString(),
              duration: log.duration || 0,
            }));

          setRuns(webhookRuns);
          return webhookRuns;
        }
      } catch (e) {
        console.error("Error fetching webhook runs:", e);
      }
      return [];
    },
    [],
  );

  return {
    triggerTestDelivery,
    fetchWebhookRuns,
    lastRunId,
    isTriggering,
    runs,
  };
}

function mapLogStatusToRunStatus(logStatus: string): WebhookRun["status"] {
  switch (logStatus) {
    case "success":
    case "completed":
      return "success";
    case "failed":
    case "error":
    case "validation_error":
      return "failed";
    case "accepted":
    case "pending":
      return "pending";
    case "running":
      return "running";
    default:
      return "pending";
  }
}
