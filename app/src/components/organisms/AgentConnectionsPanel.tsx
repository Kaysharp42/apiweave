import { useEffect, useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import { Badge } from "../atoms/Badge";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { mcp } from "../../utils/apiweaveClient";
import type { AgentMcpConnection, AgentMcpConnections, AgentMcpConnectionState } from "@shared/types";

const STATE_LABEL: Record<AgentMcpConnectionState, string> = {
  connected: "Connected",
  outdated: "Old entry",
  "not-connected": "Not connected",
  "not-installed": "Not found",
};

const STATE_VARIANT: Record<AgentMcpConnectionState, "success" | "warning" | "secondary" | "ghost"> = {
  connected: "success",
  outdated: "warning",
  "not-connected": "secondary",
  "not-installed": "ghost",
};

function needsConnecting(client: AgentMcpConnection): boolean {
  return client.state === "not-connected" || client.state === "outdated";
}

/**
 * Settings → MCP Server → Connect your agents. Writes the stdio launcher into
 * each MCP client's own user config, and only when the user clicks: these are
 * other applications' files, so nothing is written on its own.
 */
export function AgentConnectionsPanel() {
  const [connections, setConnections] = useState<AgentMcpConnections | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    void mcp.listAgentConnections().then(setConnections);
  };
  useEffect(refresh, []);

  const run = (clientId: string, action: (id: string) => Promise<AgentMcpConnections>): Promise<void> => {
    setBusyId(clientId);
    setError(null);
    return action(clientId)
      .then(setConnections)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusyId(null));
  };

  const connectAll = async (): Promise<void> => {
    for (const client of connections?.clients.filter(needsConnecting) ?? []) {
      await run(client.clientId, mcp.connectAgent);
    }
  };

  if (connections === null) return null;
  const canConnect = connections.nodePath !== null;
  const pending = connections.clients.filter(needsConnecting);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-secondary-dark">
          Connect your agents
        </span>
        <div className="flex items-center gap-1">
          {pending.length > 1 && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Plug className="h-3.5 w-3.5" />}
              disabled={!canConnect || busyId !== null}
              onClick={() => void connectAll()}
            >
              Connect all
            </Button>
          )}
          <IconButton tooltip="Check again" size="xs" variant="ghost" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
      <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
        Adds APIWeave to each agent&apos;s own user settings, so it connects even
        when APIWeave is closed. Only the <code className="font-mono">apiweave</code>{" "}
        entry is changed, and only when you click. Restart the agent afterwards.
      </p>
      {connections.nodeProblem !== null && (
        <p className="text-xs text-status-warning dark:text-(--aw-status-warning)">
          {connections.nodeProblem}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-xs text-status-error dark:text-(--aw-status-error)">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {connections.clients.map((client) => (
          <li
            key={client.clientId}
            className="flex items-start justify-between gap-3 rounded-xs border border-border bg-surface-overlay px-3 py-2 dark:border-border-dark dark:bg-surface-dark-overlay"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-medium text-text-primary dark:text-text-primary-dark">
                {client.name}
                <Badge size="xs" variant={STATE_VARIANT[client.state]}>
                  {STATE_LABEL[client.state]}
                </Badge>
              </p>
              <p className="mt-0.5 truncate font-mono text-2xs text-text-secondary dark:text-text-secondary-dark" title={client.configPath}>
                {client.configPath}
              </p>
              {client.detail !== null && (
                <p className="mt-0.5 text-2xs text-text-secondary dark:text-text-secondary-dark">{client.detail}</p>
              )}
            </div>
            {client.state === "connected" ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId !== null}
                onClick={() => void run(client.clientId, mcp.disconnectAgent)}
              >
                Disconnect
              </Button>
            ) : client.state === "not-installed" ? null : (
              <Button
                variant="secondary"
                size="sm"
                disabled={!canConnect || busyId !== null}
                onClick={() => void run(client.clientId, mcp.connectAgent)}
              >
                {client.state === "outdated" ? "Replace" : "Connect"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
