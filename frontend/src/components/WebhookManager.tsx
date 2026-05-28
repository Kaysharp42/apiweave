import { useState, useEffect, useCallback } from 'react';
import { Trash2, RefreshCw, Plus, Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from './molecules/Modal';
import { ConfirmDialog } from './molecules/ConfirmDialog';
import { FormField } from './molecules/FormField';
import { Button } from './atoms/Button';
import { Input } from './atoms/Input';
import { IconButton } from './atoms/IconButton';
import { Badge } from './atoms/Badge';
import API_BASE_URL from '../utils/api';
import type { Workflow } from '../types/Workflow';
import type { Collection } from '../types/Collection';
import type { Environment } from '../types/Environment';
import { authenticatedFetch } from '../utils/authenticatedApi';
import { WebhookCiCdExamples } from './WebhookCiCdExamples';

interface Webhook {
  webhookId: string;
  resourceType: 'workflow' | 'collection';
  resourceId: string;
  environmentId?: string;
  description?: string;
  enabled: boolean;
  url: string;
  usageCount: number;
  lastUsed?: string;
  lastStatus?: 'success' | 'failed' | 'pending';
}

interface WebhookCredentials {
  url: string;
  token: string;
  hmacSecret: string;
}

interface WebhookLog {
  logId: string;
  status: 'success' | 'failed' | 'pending';
  timestamp?: string;
  duration?: number;
  errorMessage?: string;
  runId?: string;
}

interface NewWebhookFormData {
  resourceType: 'workflow' | 'collection';
  resourceId: string;
  environmentId: string;
  description: string;
}

type CopySuccessState = Record<string, boolean>;

const buildManagementHeaders = (contentType?: boolean): HeadersInit => {
  const headers: Record<string, string> = {};
  if (contentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
};

export function WebhookManager() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [newWebhookData, setNewWebhookData] = useState<NewWebhookFormData>({
    resourceType: 'workflow', resourceId: '', environmentId: '', description: '',
  });
  const [webhookCredentials, setWebhookCredentials] = useState<WebhookCredentials | null>(null);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [webhookToRegenerate, setWebhookToRegenerate] = useState<Webhook | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
  const [copySuccess, setCopySuccess] = useState<CopySuccessState>({});
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    try {
      const [wf, col] = await Promise.all([fetchWorkflows(), fetchCollections()]);
      fetchEnvironments().catch(() => undefined);
      await fetchAllWebhooksWithData(wf || [], col || []);
    } catch (error) {
      console.error('Error loading webhook data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAllData(); }, []);

  /* ---------- Data fetching ---------- */

  const fetchWorkflows = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/workflows`);
      if (res.ok) { const d = await res.json(); const list: Workflow[] = Array.isArray(d) ? d : d.workflows || []; setWorkflows(list); return list; }
    } catch (e) { console.error('Error fetching workflows:', e); }
    return [];
  };

  const fetchCollections = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/collections`);
      if (res.ok) { const d = await res.json(); const list: Collection[] = Array.isArray(d) ? d : []; setCollections(list); return list; }
    } catch (e) { console.error('Error fetching collections:', e); }
    return [];
  };

  const fetchEnvironments = async () => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/environments`);
      if (res.ok) { const d = await res.json(); const list: Environment[] = Array.isArray(d) ? d : []; setEnvironments(list); return list; }
    } catch (e) { console.error('Error fetching environments:', e); }
    return [];
  };

  const fetchAllWebhooksWithData = async (wfList: Workflow[], colList: Collection[]) => {
    try {
      const [workflowWebhookGroups, collectionWebhookGroups] = await Promise.all([
        Promise.all(wfList.map(async (w) => {
          const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks/workflows/${w.workflowId}`);
          if (!res.ok) return [] as Webhook[];
          const d = await res.json();
          return Array.isArray(d) ? d as Webhook[] : [];
        })),
        Promise.all(colList.map(async (c) => {
          const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks/collections/${c.collectionId}`);
          if (!res.ok) return [] as Webhook[];
          const d = await res.json();
          return Array.isArray(d) ? d as Webhook[] : [];
        })),
      ]);
      setWebhooks([...workflowWebhookGroups.flat(), ...collectionWebhookGroups.flat()]);
    } catch (e) { console.error('Error fetching webhooks:', e); }
  };

  const fetchAllWebhooks = () => fetchAllWebhooksWithData(workflows || [], collections || []);

  /* ---------- Actions ---------- */

  const createWebhook = async () => {
    if (!newWebhookData.resourceId) { toast.error('Please select a workflow or collection'); return; }
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks`, {
        method: 'POST', headers: buildManagementHeaders(true), body: JSON.stringify(newWebhookData),
      });
      if (res.ok) {
        const data = await res.json();
        setWebhookCredentials(data);
        setShowCredentialsModal(true);
        setShowCreateModal(false);
        setNewWebhookData({ resourceType: 'workflow', resourceId: '', environmentId: '', description: '' });
        await fetchAllWebhooks();
        toast.success('Webhook created');
      } else {
        const err = await res.json();
        toast.error(`Failed to create webhook: ${err.detail || 'Unknown error'}`);
      }
    } catch (e) { console.error('Error creating webhook:', e); toast.error('Error creating webhook'); }
  };

  const confirmDeleteWebhook = async () => {
    if (!deleteTarget) return;
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks/${deleteTarget}`, { method: 'DELETE', headers: buildManagementHeaders() });
      if (res.ok) { await fetchAllWebhooks(); toast.success('Webhook deleted'); }
      else toast.error('Failed to delete webhook');
    } catch (e) { console.error('Error deleting webhook:', e); toast.error('Error deleting webhook'); }
    finally { setDeleteTarget(null); }
  };

  const toggleWebhook = async (webhook: Webhook) => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks/${webhook.webhookId}`, {
        method: 'PATCH', headers: buildManagementHeaders(true), body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      if (res.ok) await fetchAllWebhooks();
      else toast.error('Failed to update webhook');
    } catch (e) { console.error('Error updating webhook:', e); toast.error('Error updating webhook'); }
  };

  const confirmRegenerate = async () => {
    if (!webhookToRegenerate) return;
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks/${webhookToRegenerate.webhookId}/regenerate-token`, { method: 'POST', headers: buildManagementHeaders() });
      if (res.ok) {
        const data = await res.json();
        setWebhookCredentials(data);
        setShowCredentialsModal(true);
        setShowRegenerateModal(false);
        setWebhookToRegenerate(null);
        await fetchAllWebhooks();
      } else {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
        toast.error(`Failed to regenerate credentials: ${err.detail || 'Unknown error'}`);
        setShowRegenerateModal(false);
        setWebhookToRegenerate(null);
      }
    } catch (e) {
      console.error('Error regenerating credentials:', e);
      toast.error(`Error regenerating credentials: ${(e as Error).message}`);
      setShowRegenerateModal(false);
      setWebhookToRegenerate(null);
    }
  };

  const viewLogs = async (webhook: Webhook) => {
    setSelectedWebhook(webhook);
    setShowLogsModal(true);
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/webhooks/${webhook.webhookId}/logs?limit=50`, { headers: buildManagementHeaders() });
      if (res.ok) { const d = await res.json(); setWebhookLogs(d.logs || []); }
    } catch (e) { console.error('Error fetching webhook logs:', e); }
  };

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopySuccess((prev) => ({ ...prev, [key]: false })), 2000);
    } catch (e) { console.error('Failed to copy:', e); }
  };

  /* ---------- Helpers ---------- */

  const getResourceName = (wh: Webhook) => {
    if (wh.resourceType === 'workflow') return (workflows || []).find(w => w.workflowId === wh.resourceId)?.name || wh.resourceId;
    return (collections || []).find(c => c.collectionId === wh.resourceId)?.name || wh.resourceId;
  };

  const getEnvironmentName = (envId: string | undefined) => {
    if (!envId) return 'None';
    return (environments || []).find(e => e.environmentId === envId)?.name || envId;
  };

  const formatDate = (d: string | undefined) => d ? new Date(d).toLocaleString() : 'Never';

  const statusBadgeVariant = (s: string): 'success' | 'error' | 'warning' => {
    if (s === 'success') return 'success';
    if (s === 'failed') return 'error';
    return 'warning';
  };

  /* ---------- Render ---------- */

  if (loading) {
    return <div className="flex items-center justify-center h-full"><span className="text-sm text-text-muted dark:text-text-muted-dark">Loading webhooks\u2026</span></div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border dark:border-border-dark">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">Webhooks</h2>
          <Button onClick={() => setShowCreateModal(true)} variant="primary" size="sm">
            <Plus className="w-4 h-4" /> Create
          </Button>
        </div>
        <p className="text-xs text-text-muted dark:text-text-muted-dark">Manage CI/CD webhooks for workflows and collections</p>
      </div>

      {/* Webhooks List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {webhooks.length === 0 ? (
          <div className="text-center py-8 text-text-muted dark:text-text-muted-dark">
            <p className="text-sm">No webhooks created yet.</p>
            <p className="text-xs mt-2">Create a webhook to integrate with CI/CD pipelines.</p>
          </div>
        ) : webhooks.map((wh) => (
          <div key={wh.webhookId} className="border border-border dark:border-border-dark rounded-lg p-3 bg-surface-raised dark:bg-surface-dark-raised">
            {/* Header row */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm text-text-primary dark:text-text-primary-dark">{getResourceName(wh)}</span>
                  <Badge variant={wh.resourceType === 'workflow' ? 'info' : 'secondary'} size="sm">{wh.resourceType}</Badge>
                  <Button
                    onClick={() => toggleWebhook(wh)}
                    variant="ghost"
                    size="xs"
                    className={`cursor-pointer ${wh.enabled ? 'text-status-success' : 'text-text-muted'}`}
                  >
                    {wh.enabled ? 'Enabled' : 'Disabled'}
                  </Button>
                </div>
                {wh.description && <p className="text-xs text-text-muted dark:text-text-muted-dark">{wh.description}</p>}
              </div>
            </div>

            {/* Info */}
            <div className="space-y-1 text-xs text-text-secondary dark:text-text-secondary-dark mb-2">
              <div className="flex items-center gap-2"><span className="font-medium">Environment:</span><span>{getEnvironmentName(wh.environmentId)}</span></div>
              <div className="flex items-center gap-2"><span className="font-medium">Last Used:</span><span>{formatDate(wh.lastUsed)}</span></div>
              <div className="flex items-center gap-2">
                <span className="font-medium">Usage:</span><span>{wh.usageCount}</span>
                {wh.lastStatus && <Badge variant={statusBadgeVariant(wh.lastStatus)} size="xs">{wh.lastStatus}</Badge>}
              </div>
            </div>

            {/* URL */}
            <div className="mb-2">
              <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark">Webhook URL:</span>
              <div className="flex items-center gap-2 mt-1">
                <input type="text" readOnly value={wh.url} aria-label="Webhook URL" className="input input-bordered input-sm flex-1 font-mono text-xs bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark" />
                <IconButton onClick={() => copyToClipboard(wh.url, `url-${wh.webhookId}`)} variant="ghost" size="sm" title="Copy URL">
                  {copySuccess[`url-${wh.webhookId}`] ? <Check className="w-4 h-4 text-status-success" /> : <Copy className="w-4 h-4" />}
                </IconButton>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-border dark:border-border-dark">
              <Button onClick={() => viewLogs(wh)} variant="ghost" size="sm">View Logs</Button>
              <Button onClick={() => { setWebhookToRegenerate(wh); setShowRegenerateModal(true); }} variant="ghost" size="sm" intent="warning">
                <RefreshCw className="w-3.5 h-3.5" /> Regenerate
              </Button>
              <Button onClick={() => setDeleteTarget(wh.webhookId)} variant="ghost" size="sm" intent="error">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Sub-Modals ---- */}

      {/* Create Webhook */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Webhook" size="sm"
        footer={() => <div className="flex gap-3 w-full"><Button onClick={() => setShowCreateModal(false)} variant="ghost" fullWidth>Cancel</Button><Button onClick={createWebhook} variant="primary" fullWidth>Create</Button></div>}>
        <div className="space-y-4 p-5">
          <FormField label="Resource Type">
            <select value={newWebhookData.resourceType} onChange={(e) => setNewWebhookData({ ...newWebhookData, resourceType: e.target.value as 'workflow' | 'collection', resourceId: '' })} className="select select-bordered w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark">
              <option value="workflow">Workflow</option>
              <option value="collection">Collection</option>
            </select>
          </FormField>
          <FormField label={newWebhookData.resourceType === 'workflow' ? 'Workflow' : 'Collection'}>
            <select value={newWebhookData.resourceId} onChange={(e) => setNewWebhookData({ ...newWebhookData, resourceId: e.target.value })} className="select select-bordered w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark">
              <option value="">Select {newWebhookData.resourceType}…</option>
              {newWebhookData.resourceType === 'workflow'
                ? (workflows || []).map(w => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)
                : (collections || []).map(c => <option key={c.collectionId} value={c.collectionId}>{c.name}</option>)}
            </select>
          </FormField>
          <FormField label="Environment (Optional)">
            <select value={newWebhookData.environmentId} onChange={(e) => setNewWebhookData({ ...newWebhookData, environmentId: e.target.value })} className="select select-bordered w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark">
              <option value="">None</option>
              {(environments || []).map(env => <option key={env.environmentId} value={env.environmentId}>{env.name}</option>)}
            </select>
          </FormField>
          <FormField label="Description (Optional)">
            <Input type="text" value={newWebhookData.description} onChange={(e) => setNewWebhookData({ ...newWebhookData, description: e.target.value })} placeholder="e.g., Production deployment webhook" className="w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark placeholder:text-text-muted dark:placeholder:text-text-muted-dark" />
          </FormField>
        </div>
      </Modal>

      {/* Credentials Modal */}
      <Modal isOpen={showCredentialsModal && !!webhookCredentials} onClose={() => { setShowCredentialsModal(false); setWebhookCredentials(null); }} title="Webhook Credentials" size="md"
        footer={() => <Button onClick={() => { setShowCredentialsModal(false); setWebhookCredentials(null); }} variant="primary" fullWidth>I've Saved the Credentials</Button>}>
        <div className="space-y-4 p-5">
          <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
            <p className="text-sm text-text-primary dark:text-text-primary-dark">⚠️ <strong>Important:</strong> Copy these credentials now. They will not be shown again!</p>
          </div>
          {webhookCredentials && (['url', 'token', 'hmacSecret'] as const).map((field) => {
            const labels: Record<string, string> = { url: 'Webhook URL', token: 'Webhook Token (X-Webhook-Token header)', hmacSecret: 'HMAC Secret (for signature validation)' };
            const key = `cred-${field}`;
            return (
              <FormField key={field} label={labels[field] ?? ''}>
                <div className="flex items-center gap-2">
                    <input type="text" readOnly value={webhookCredentials[field]} aria-label={labels[field] ?? 'Webhook credential'} className="input input-bordered flex-1 font-mono text-sm bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark" />
                  <IconButton onClick={() => copyToClipboard(webhookCredentials[field], key)} variant="primary" size="sm">
                    {copySuccess[key] ? <Check className="w-4 h-4" /> : 'Copy'}
                  </IconButton>
                </div>
              </FormField>
            );
          })}
          {webhookCredentials && (
            <FormField label="cURL Example">
              <pre className="text-xs bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-lg p-3 overflow-x-auto font-mono">
{`curl -X POST "${webhookCredentials.url}" \\
  -H "X-Webhook-Token: ${webhookCredentials.token}" \\
  -H "Content-Type: application/json" \\
  -d '{}'`}
              </pre>
            </FormField>
          )}
          <FormField label="CI/CD Examples">
<WebhookCiCdExamples />
          </FormField>
        </div>
      </Modal>

      {/* Logs Modal */}
      <Modal isOpen={showLogsModal && !!selectedWebhook} onClose={() => { setShowLogsModal(false); setSelectedWebhook(null); setWebhookLogs([]); }} title="Webhook Execution Logs" size="lg">
        {webhookLogs.length === 0 ? (
          <div className="text-center py-8 text-text-muted dark:text-text-muted-dark">No execution logs yet</div>
        ) : (
          <div className="space-y-2">
            {webhookLogs.map((log) => (
              <div key={log.logId} className="border border-border dark:border-border-dark rounded-lg p-3 bg-surface-raised dark:bg-surface-dark-raised">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant={statusBadgeVariant(log.status)} size="sm">{log.status}</Badge>
                  <span className="text-xs text-text-muted dark:text-text-muted-dark">{formatDate(log.timestamp)}</span>
                </div>
                {log.duration && <div className="text-xs text-text-secondary dark:text-text-secondary-dark">Duration: {(log.duration / 1000).toFixed(2)}s</div>}
                {log.errorMessage && <div className="text-xs text-status-error mt-1">Error: {log.errorMessage}</div>}
                {log.runId && <div className="text-xs text-primary mt-1">Run ID: {log.runId}</div>}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Regenerate Confirmation */}
      <ConfirmDialog
        open={showRegenerateModal && !!webhookToRegenerate}
        title="Regenerate Credentials?"
        message="Are you sure you want to regenerate credentials? The old credentials will be invalidated immediately. Any systems using the old token or HMAC secret will stop working."
        confirmLabel="Regenerate"
        intent="warning"
        onConfirm={confirmRegenerate}
        onClose={() => { setShowRegenerateModal(false); setWebhookToRegenerate(null); }}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Webhook?"
        message="Are you sure you want to delete this webhook? This action cannot be undone."
        confirmLabel="Delete"
        intent="error"
        onConfirm={confirmDeleteWebhook}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default WebhookManager;
