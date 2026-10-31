import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "../atoms/Button";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { ToggleSetting } from "../molecules/ToggleSetting";
import { mcp } from "../../utils/apiweaveClient";
import type { McpStatus } from "@shared/types/McpStatus";
import type { AgentRunApproval } from "@shared/types/AgentRunApproval";

/** The `mcpServers` config snippet an MCP client pastes to reach the local server.
 * HTTP transport (not stdio) with the per-install bearer token. */
function clientConfig(url: string, token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        apiweave: {
          type: "http",
          url,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

function useCopy(): readonly [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return [copied, copy];
}

export function McpSetupPanel() {
  const [status, setStatus] = useState<McpStatus>({
    running: false,
    config: null,
    autoApproveAgentRuns: false,
  });
  const [busy, setBusy] = useState(false);
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [approvals, setApprovals] = useState<readonly AgentRunApproval[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  useEffect(() => {
    void mcp.getStatus().then(setStatus);
    void mcp.listAgentApprovals().then(setApprovals);
  }, []);

  const onRevoke = (approvalId: string): void => {
    setRevokingId(approvalId);
    void mcp
      .revokeAgentApproval(approvalId)
      .then((removed) => {
        if (removed) {
          setApprovals((current) =>
            current.filter((approval) => approval.approvalId !== approvalId),
          );
        }
      })
      .finally(() => setRevokingId(null));
  };

  const onToggle = (): void => {
    setBusy(true);
    const next = status.running ? mcp.disable() : mcp.enable();
    void next.then(setStatus).finally(() => setBusy(false));
  };

  const onToggleAutoApprove = (): void => {
    setBusy(true);
    void mcp
      .setAutoApproveAgentRuns(!status.autoApproveAgentRuns)
      .then(setStatus)
      .finally(() => setBusy(false));
  };

  const onRegenerate = (): void => {
    setConfirmingRegenerate(false);
    setBusy(true);
    void mcp
      .regenerateToken()
      .then(setStatus)
      .finally(() => setBusy(false));
  };

  const config = status.config;
  const bridgeCommand =
    config &&
    `npx mcp-remote ${config.url} --header "Authorization: Bearer ${config.token}"`;

  return (
    <div className="space-y-5">
      <ToggleSetting
        title="Enable local MCP server"
        description={
          "Lets an MCP client (Claude, Cursor, …) drive your workflows over a " +
          "loopback-only HTTP endpoint. Off until you enable it; your choice " +
          "is remembered across restarts. A per-install token is required on " +
          "every request. Secrets are never exposed."
        }
        checked={status.running}
        onToggle={onToggle}
        disabled={busy || !mcp.isAvailable()}
      />

      {!mcp.isAvailable() && (
        <p className="text-xs text-status-warning">
          The MCP server is only available in the desktop app.
        </p>
      )}

      {status.running && config && (
        <div className="space-y-4">
          <div className="rounded-sm border border-border bg-surface-overlay px-3 py-2 text-xs dark:border-border-dark dark:bg-surface-dark-overlay">
            <span className="text-text-secondary dark:text-text-secondary-dark">
              Listening on{" "}
            </span>
            <code className="text-text-primary dark:text-text-primary-dark">
              {config.url}
            </code>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
                Client config
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copy(clientConfig(config.url, config.token))}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-sm border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark">
              {clientConfig(config.url, config.token)}
            </pre>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
              Stdio-only client?
            </span>
            <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
              Bridge stdio to this endpoint with:
            </p>
            <pre className="mt-1 overflow-x-auto rounded-sm border border-border bg-surface-raised px-3 py-2 text-xs text-text-primary dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark">
              {bridgeCommand}
            </pre>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Think the token has leaked? Replace it. Every client has to be
              given the new one.
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              disabled={busy}
              onClick={() => setConfirmingRegenerate(true)}
            >
              Regenerate token
            </Button>
          </div>
        </div>
      )}

      <ToggleSetting
        title="Skip secret approval for agent runs"
        description={
          "A run an MCP client starts sends its resolved secrets without asking " +
          "you first. The run is still limited to the destinations it reports " +
          "when it starts. This applies to every client — leave it off unless " +
          "you trust all of them."
        }
        checked={status.autoApproveAgentRuns}
        onToggle={onToggleAutoApprove}
        disabled={busy || !mcp.isAvailable()}
      />

      {approvals.length > 0 && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
            Remembered approvals
          </span>
          <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
            Runs of these workflows answer the secrets question without asking.
            Revoke one to be asked again. An edit to its secrets, destinations
            or scripts asks again on its own.
          </p>
          <ul className="mt-2 space-y-2">
            {approvals.map((approval) => (
              <li
                key={approval.approvalId}
                className="rounded-sm border border-border bg-surface-overlay px-3 py-2 dark:border-border-dark dark:bg-surface-dark-overlay"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-text-primary dark:text-text-primary-dark">
                      <span className="font-medium">{approval.workflowName}</span>
                      <span className="text-text-secondary dark:text-text-secondary-dark">
                        {" "}— {approval.agent}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-text-secondary dark:text-text-secondary-dark">
                      Secrets: {approval.secretNames.join(", ")}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-text-secondary dark:text-text-secondary-dark">
                      To: {approval.destinations.join(", ") || "(no request URLs found)"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={revokingId === approval.approvalId}
                    onClick={() => onRevoke(approval.approvalId)}
                  >
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirmingRegenerate}
        onClose={() => setConfirmingRegenerate(false)}
        onConfirm={onRegenerate}
        title="Regenerate the MCP token?"
        message="The current token stops working immediately and open MCP sessions are closed. Paste the new client config into each MCP client, and relaunch any agent you started from APIWeave."
        confirmLabel="Regenerate"
        intent="warning"
      />
    </div>
  );
}
