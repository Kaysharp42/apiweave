import { useState, useEffect } from 'react';
import { Server, Plug, BookOpen, MessageSquare, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { Button, Badge, Spinner } from './atoms';
import { Panel, PanelTabs, EmptyState } from './molecules';
import type { MCPConfig } from '../types/MCPConfig';
import type { MCPTool } from '../types/MCPTool';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

type TabKey = 'status' | 'tools' | 'resources' | 'prompts' | 'connect';

interface MCPManagerProps {
  className?: string;
}

export default function MCPManager({ className = '' }: MCPManagerProps) {
  const [config, setConfig] = useState<MCPConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('status');
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/mcp/config`);
      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      } else if (response.status === 404) {
        setError('MCP endpoint not found. Ensure MCP_ENABLED=true in backend .env');
      } else {
        setError('Failed to fetch MCP configuration');
      }
    } catch {
      setError('Cannot connect to backend. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'apiweave-ui', version: '0.1.0' },
          },
        }),
      });
      setTestResult(response.ok ? 'success' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  };

  const tabs = [
    { key: 'status' as TabKey, icon: Server, label: 'Status' },
    { key: 'tools' as TabKey, icon: Plug, label: 'Tools' },
    { key: 'resources' as TabKey, icon: BookOpen, label: 'Resources' },
    { key: 'prompts' as TabKey, icon: MessageSquare, label: 'Prompts' },
    { key: 'connect' as TabKey, icon: ExternalLink, label: 'Connect' },
  ];

  if (loading) {
    return (
      <div className={`flex h-full items-center justify-center ${className}`}>
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex h-full flex-col ${className}`}>
        <EmptyState
          icon={<Server className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
          title="MCP Unavailable"
          description={error}
          action={
            <Button variant="primary" size="sm" onClick={fetchConfig}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (!config) return null;

  const renderStatus = () => (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
          MCP Server
        </span>
        <Badge
          variant={config.enabled ? 'success' : 'error'}
          size="sm"
        >
          {config.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
          HTTP Transport
        </span>
        <Badge
          variant={config.httpEnabled ? 'success' : 'warning'}
          size="sm"
        >
          {config.httpEnabled ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-secondary dark:text-text-secondary-dark">
          API Key
        </span>
        <Badge
          variant={config.apiKeyConfigured ? 'success' : 'warning'}
          size="sm"
        >
          {config.apiKeyConfigured ? 'Configured' : 'Not Set'}
        </Badge>
      </div>

      <div className="divider my-2" />

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          Summary
        </h4>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3 text-center">
            <div className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
              {config.toolCount}
            </div>
            <div className="text-xs text-text-muted dark:text-text-muted-dark">Tools</div>
          </div>
          <div className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3 text-center">
            <div className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
              {config.resourceCount}
            </div>
            <div className="text-xs text-text-muted dark:text-text-muted-dark">Resources</div>
          </div>
          <div className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3 text-center">
            <div className="text-2xl font-bold text-text-primary dark:text-text-primary-dark">
              {config.promptCount}
            </div>
            <div className="text-xs text-text-muted dark:text-text-muted-dark">Prompts</div>
          </div>
        </div>
      </div>

      <div className="divider my-2" />

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted dark:text-text-muted-dark">
          Test Connection
        </h4>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={testConnection}
            loading={testing}
            disabled={!config.httpEnabled}
          >
            Test HTTP Endpoint
          </Button>
          {testResult === 'success' && (
            <span className="flex items-center gap-1 text-xs text-success">
              <CheckCircle className="w-3.5 h-3.5" /> Connected
            </span>
          )}
          {testResult === 'error' && (
            <span className="flex items-center gap-1 text-xs text-error">
              <XCircle className="w-3.5 h-3.5" /> Failed
            </span>
          )}
        </div>
        {!config.httpEnabled && (
          <p className="text-xs text-text-muted dark:text-text-muted-dark">
            Enable HTTP transport in backend .env to test connection.
          </p>
        )}
      </div>
    </div>
  );

  const renderTools = () => (
    <div className="p-4">
      {config.tools.length === 0 ? (
        <EmptyState
          icon={<Plug className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
          title="No Tools Available"
          description="MCP tools are not registered. Check server configuration."
        />
      ) : (
        <div className="space-y-2">
          {config.tools.map((tool: MCPTool) => (
            <div
              key={tool.name}
              className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <code className="text-sm font-mono text-primary dark:text-cyan-400">
                  {tool.name}
                </code>
              </div>
              <p className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
                {tool.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPlaceholder = (title: string, description: string, IconComponent: React.ComponentType<React.SVGProps<SVGSVGElement>>) => (
    <div className="p-4">
      <EmptyState
        icon={<IconComponent className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
        title={title}
        description={description}
      />
    </div>
  );

  const renderConnect = () => {
    const stdioConfig = `{
  "mcp": {
    "apiweave": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_stdio.py"],
      "cwd": "/path/to/apiweave/backend"
    }
  }
}`;

    const httpConfig = `{
  "mcp": {
    "apiweave": {
      "type": "http",
      "url": "${config.baseUrl || 'http://localhost:8000'}/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_API_KEY"
      }
    }
  }
}`;

    return (
      <div className="space-y-4 p-4">
        <div>
          <h4 className="text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
            Stdio Configuration
          </h4>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-2">
            For local agents (Claude Desktop, Cursor, opencode)
          </p>
          <div className="relative">
            <pre className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3 text-xs font-mono overflow-x-auto">
              {stdioConfig}
            </pre>
          </div>
        </div>

        <div className="divider my-2" />

        <div>
          <h4 className="text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
            HTTP Configuration
          </h4>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark mb-2">
            For remote agents (requires MCP_HTTP_ENABLED=true)
          </p>
          <div className="relative">
            <pre className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3 text-xs font-mono overflow-x-auto">
              {httpConfig}
            </pre>
          </div>
        </div>

        <div className="divider my-2" />

        <div>
          <h4 className="text-sm font-medium text-text-primary dark:text-text-primary-dark mb-2">
            Quick Setup Commands
          </h4>
          <div className="space-y-2">
            <div className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3">
              <code className="text-xs font-mono text-text-primary dark:text-text-primary-dark">
                codex mcp add apiweave -- python mcp_stdio.py
              </code>
              <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
                OpenAI Codex CLI
              </p>
            </div>
            <div className="rounded-lg bg-surface-overlay dark:bg-surface-dark-overlay p-3">
              <code className="text-xs font-mono text-text-primary dark:text-text-primary-dark">
                /mcp add apiweave  (in Copilot CLI)
              </code>
              <p className="text-xs text-text-muted dark:text-text-muted-dark mt-1">
                GitHub Copilot CLI
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'status': return renderStatus();
      case 'tools': return renderTools();
      case 'resources': return renderPlaceholder('Resources', 'MCP resources provide read-only data snapshots for agent context.', BookOpen);
      case 'prompts': return renderPlaceholder('Prompts', 'MCP prompts are pre-built templates for common APIWeave tasks.', MessageSquare);
      case 'connect': return renderConnect();
      default: return null;
    }
  };

  return (
    <div className={`flex h-full flex-col ${className}`}>
      <Panel
        title="MCP Server"
        headerActions={
          <Button variant="ghost" size="xs" onClick={fetchConfig}>
            Refresh
          </Button>
        }
      >
        <PanelTabs
          tabs={tabs.map(({ key, icon: Icon, label }) => ({ key, icon: Icon, label }))}
          activeTab={activeTab}
          onTabChange={(key: string) => setActiveTab(key as TabKey)}
        />
        <div className="flex-1 overflow-y-auto">
          {renderContent()}
        </div>
      </Panel>
    </div>
  );
}
