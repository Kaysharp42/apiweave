import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Modal } from "../molecules/Modal";
import { Button } from "../atoms/Button";
import { Toggle } from "../atoms/Toggle";
import { mcp } from "../../utils/apiweaveClient";
import type { McpStatus } from "../../../../shared/types/McpStatus";

interface McpSetupModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

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

export function McpSetupModal({ isOpen, onClose }: McpSetupModalProps) {
  const [status, setStatus] = useState<McpStatus>({
    running: false,
    config: null,
  });
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();

  useEffect(() => {
    if (!isOpen) return;
    void mcp.getStatus().then(setStatus);
  }, [isOpen]);

  const onToggle = (): void => {
    setBusy(true);
    const next = status.running ? mcp.disable() : mcp.enable();
    void next.then(setStatus).finally(() => setBusy(false));
  };

  const config = status.config;
  const bridgeCommand =
    config &&
    `npx mcp-remote ${config.url} --header "Authorization: Bearer ${config.token}"`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="MCP Server" size="md">
      <div className="space-y-5 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-primary dark:text-text-primary-dark">
              Enable local MCP server
            </p>
            <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
              Lets an MCP client (Claude, Cursor, …) drive your workflows over a
              loopback-only HTTP endpoint.               Off until you enable it; your choice is remembered across
              restarts. A per-install token is required on every request.
              Secrets are never exposed.
            </p>
          </div>
          <Toggle
            checked={status.running}
            onChange={onToggle}
            disabled={busy || !mcp.isAvailable()}
            variant="success"
          />
        </div>

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
          </div>
        )}
      </div>
    </Modal>
  );
}
