import { Download } from "lucide-react";
import { Button } from "../atoms/Button";
import { authenticatedFetch } from "../../utils/apiweaveClient";
import API_BASE_URL from "../../utils/apiweaveClient";
import type { AuditEventFilter } from "../../types";

interface AuditJsonExportButtonProps {
  filters: AuditEventFilter;
}

function buildExportUrl(filters: AuditEventFilter): string {
  const params = new URLSearchParams();
  if (filters.actor) params.set("actor", filters.actor);
  if (filters.action) params.set("action", filters.action);
  if (filters.scope) params.set("scope", filters.scope);
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  return `${API_BASE_URL}/api/audit/events/export${qs ? `?${qs}` : ""}`;
}

export function AuditJsonExportButton({ filters }: AuditJsonExportButtonProps) {
  const handleExport = async () => {
    try {
      const url = buildExportUrl(filters);
      const response = await authenticatedFetch(url);
      if (!response.ok) {
        throw new Error(`Export failed: ${response.status}`);
      }
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = "audit-events.json";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
    } catch {
      // Silently fail — user can retry
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      icon={<Download className="w-4 h-4" aria-hidden="true" />}
      onClick={handleExport}
    >
      Export JSON
    </Button>
  );
}
