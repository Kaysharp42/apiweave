import React, { useState, useEffect } from 'react';
import { Copy, Trash2, RefreshCw, Plus, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, ConfirmDialog } from './molecules';
import Button from './atoms/Button';
import API_BASE_URL from '../utils/api';

const WebhookManager = () => {
  const [webhooks, setWebhooks] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [collections, setCollections] = useState([]);
  const [environments, setEnvironments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [newWebhookData, setNewWebhookData] = useState({
    resourceType: 'workflow', resourceId: '', environmentId: '', description: '',
  });
  const [webhookCredentials, setWebhookCredentials] = useState(null);
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [webhookToRegenerate, setWebhookToRegenerate] = useState(null);
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [copySuccess, setCopySuccess] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => { loadAllData(); }, []);

  /* ---------- Data fetching ---------- */

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [wf, col, env] = await Promise.all([fetchWorkflows(), fetchCollections(), fetchEnvironments()]);
      await fetchAllWebhooksWithData(wf || [], col || []);
    } catch (error) {
      console.error('Error loading webhook data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflows = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/workflows`);
      if (res.ok) { const d = await res.json(); const list = Array.isArray(d) ? d : d.workflows || []; setWorkflows(list); return list; }
    } catch (e) { console.error('Error fetching workflows:', e); }
    return [];
  };

  const fetchCollections = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/collections`);
      if (res.ok) { const d = await res.json(); const list = Array.isArray(d) ? d : []; setCollections(list); return list; }
    } catch (e) { console.error('Error fetching collections:', e); }
    return [];
  };

  const fetchEnvironments = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/environments`);
      if (res.ok) { const d = await res.json(); const list = Array.isArray(d) ? d : []; setEnvironments(list); return list; }
    } catch (e) { console.error('Error fetching environments:', e); }
    return [];
  };

  const fetchAllWebhooksWithData = async (wfList, colList) => {
    try {
      const all = [];
      for (const w of wfList) {
        const res = await fetch(`${API_BASE_URL}/api/webhooks/workflows/${w.workflowId}`);
        if (res.ok) { const d = await res.json(); all.push(...(Array.isArray(d) ? d : [])); }
      }
      for (const c of colList) {
        const res = await fetch(`${API_BASE_URL}/api/webhooks/collections/${c.collectionId}`);
        if (res.ok) { const d = await res.json(); all.push(...(Array.isArray(d) ? d : [])); }
      }
      setWebhooks(all);
    } catch (e) { console.error('Error fetching webhooks:', e); }
  };

  const fetchAllWebhooks = () => fetchAllWebhooksWithData(workflows || [], collections || []);

  /* ---------- Actions ---------- */

  const createWebhook = async () => {
    if (!newWebhookData.resourceId) { toast.error('Please select a workflow or collection'); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newWebhookData),
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
      const res = await fetch(`${API_BASE_URL}/api/webhooks/${deleteTarget}`, { method: 'DELETE' });
      if (res.ok) { await fetchAllWebhooks(); toast.success('Webhook deleted'); }
      else toast.error('Failed to delete webhook');
    } catch (e) { console.error('Error deleting webhook:', e); toast.error('Error deleting webhook'); }
    finally { setDeleteTarget(null); }
  };

  const toggleWebhook = async (webhook) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks/${webhook.webhookId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      if (res.ok) await fetchAllWebhooks();
      else toast.error('Failed to update webhook');
    } catch (e) { console.error('Error updating webhook:', e); toast.error('Error updating webhook'); }
  };

  const confirmRegenerate = async () => {
    if (!webhookToRegenerate) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks/${webhookToRegenerate.webhookId}/regenerate-token`, { method: 'POST' });
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
      toast.error(`Error regenerating credentials: ${e.message}`);
      setShowRegenerateModal(false);
      setWebhookToRegenerate(null);
    }
  };

  const viewLogs = async (webhook) => {
    setSelectedWebhook(webhook);
    setShowLogsModal(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/webhooks/${webhook.webhookId}/logs?limit=50`);
      if (res.ok) { const d = await res.json(); setWebhookLogs(d.logs || []); }
    } catch (e) { console.error('Error fetching webhook logs:', e); }
  };

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => setCopySuccess((prev) => ({ ...prev, [key]: false })), 2000);
    } catch (e) { console.error('Failed to copy:', e); }
  };

  /* ---------- Helpers ---------- */

  const getResourceName = (wh) => {
    if (wh.resourceType === 'workflow') return (workflows || []).find(w => w.workflowId === wh.resourceId)?.name || wh.resourceId;
    return (collections || []).find(c => c.collectionId === wh.resourceId)?.name || wh.resourceId;
  };

  const getEnvironmentName = (envId) => {
    if (!envId) return 'None';
    return (environments || []).find(e => e.environmentId === envId)?.name || envId;
  };

  const formatDate = (d) => d ? new Date(d).toLocaleString() : 'Never';

  const statusBadge = (s) => ({
    success: 'badge-success', failed: 'badge-error', pending: 'badge-warning',
  }[s] || 'badge-warning');

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
                  <span className={`badge badge-sm ${wh.resourceType === 'workflow' ? 'badge-info' : 'badge-secondary'}`}>{wh.resourceType}</span>
                  <button onClick={() => toggleWebhook(wh)} className={`badge badge-sm cursor-pointer ${wh.enabled ? 'badge-success' : 'badge-ghost'}`}>
                    {wh.enabled ? 'Enabled' : 'Disabled'}
                  </button>
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
                {wh.lastStatus && <span className={`badge badge-xs ${statusBadge(wh.lastStatus)}`}>{wh.lastStatus}</span>}
              </div>
            </div>

            {/* URL */}
            <div className="mb-2">
              <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark">Webhook URL:</span>
              <div className="flex items-center gap-2 mt-1">
                <input type="text" readOnly value={wh.url} className="input input-bordered input-sm flex-1 font-mono text-xs" />
                <Button onClick={() => copyToClipboard(wh.url, `url-${wh.webhookId}`)} variant="ghost" size="xs" title="Copy URL">
                  {copySuccess[`url-${wh.webhookId}`] ? <Check className="w-3.5 h-3.5 text-status-success" /> : <Copy className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-border dark:border-border-dark">
              <Button onClick={() => viewLogs(wh)} variant="ghost" size="xs">View Logs</Button>
              <Button onClick={() => { setWebhookToRegenerate(wh); setShowRegenerateModal(true); }} variant="ghost" size="xs" intent="warning">
                <RefreshCw className="w-3 h-3" /> Regenerate
              </Button>
              <Button onClick={() => setDeleteTarget(wh.webhookId)} variant="ghost" size="xs" intent="error">
                <Trash2 className="w-3 h-3" /> Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* ---- Sub-Modals ---- */}

      {/* Create Webhook */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Webhook" size="sm"
        footer={<div className="flex gap-3 w-full"><Button onClick={() => setShowCreateModal(false)} variant="ghost" fullWidth>Cancel</Button><Button onClick={createWebhook} variant="primary" fullWidth>Create</Button></div>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Resource Type</label>
            <select value={newWebhookData.resourceType} onChange={(e) => setNewWebhookData({ ...newWebhookData, resourceType: e.target.value, resourceId: '' })} className="select select-bordered w-full">
              <option value="workflow">Workflow</option>
              <option value="collection">Collection</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">{newWebhookData.resourceType === 'workflow' ? 'Workflow' : 'Collection'}</label>
            <select value={newWebhookData.resourceId} onChange={(e) => setNewWebhookData({ ...newWebhookData, resourceId: e.target.value })} className="select select-bordered w-full">
              <option value="">Select {newWebhookData.resourceType}\u2026</option>
              {newWebhookData.resourceType === 'workflow'
                ? (workflows || []).map(w => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)
                : (collections || []).map(c => <option key={c.collectionId} value={c.collectionId}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Environment (Optional)</label>
            <select value={newWebhookData.environmentId} onChange={(e) => setNewWebhookData({ ...newWebhookData, environmentId: e.target.value })} className="select select-bordered w-full">
              <option value="">None</option>
              {(environments || []).map(env => <option key={env.environmentId} value={env.environmentId}>{env.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">Description (Optional)</label>
            <input type="text" value={newWebhookData.description} onChange={(e) => setNewWebhookData({ ...newWebhookData, description: e.target.value })} placeholder="e.g., Production deployment webhook" className="input input-bordered w-full" />
          </div>
        </div>
      </Modal>

      {/* Credentials Modal */}
      <Modal open={showCredentialsModal && !!webhookCredentials} onClose={() => { setShowCredentialsModal(false); setWebhookCredentials(null); }} title="Webhook Credentials" size="md"
        footer={<Button onClick={() => { setShowCredentialsModal(false); setWebhookCredentials(null); }} variant="primary" fullWidth>I've Saved the Credentials</Button>}>
        <div className="space-y-4">
          <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg">
            <p className="text-sm text-text-primary dark:text-text-primary-dark">\u26a0\ufe0f <strong>Important:</strong> Copy these credentials now. They will not be shown again!</p>
          </div>
          {webhookCredentials && ['url', 'token', 'hmacSecret'].map((field) => {
            const labels = { url: 'Webhook URL', token: 'Webhook Token (X-Webhook-Token header)', hmacSecret: 'HMAC Secret (for signature validation)' };
            const key = `cred-${field}`;
            return (
              <div key={field}>
                <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">{labels[field]}</label>
                <div className="flex items-center gap-2">
                  <input type="text" readOnly value={webhookCredentials[field]} className="input input-bordered flex-1 font-mono text-sm" />
                  <Button onClick={() => copyToClipboard(webhookCredentials[field], key)} variant="primary" size="sm">
                    {copySuccess[key] ? <Check className="w-4 h-4" /> : 'Copy'}
                  </Button>
                </div>
              </div>
            );
          })}
          {webhookCredentials && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-text-secondary-dark mb-1">cURL Example</label>
              <pre className="text-xs bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded-lg p-3 overflow-x-auto font-mono">
{`curl -X POST "${webhookCredentials.url}" \\
  -H "X-Webhook-Token: ${webhookCredentials.token}" \\
  -H "Content-Type: application/json" \\
  -d '{}'`}
              </pre>
            </div>
          )}
        </div>
      </Modal>

      {/* Logs Modal */}
      <Modal open={showLogsModal && !!selectedWebhook} onClose={() => { setShowLogsModal(false); setSelectedWebhook(null); setWebhookLogs([]); }} title="Webhook Execution Logs" size="lg">
        {webhookLogs.length === 0 ? (
          <div className="text-center py-8 text-text-muted dark:text-text-muted-dark">No execution logs yet</div>
        ) : (
          <div className="space-y-2">
            {webhookLogs.map((log) => (
              <div key={log.logId} className="border border-border dark:border-border-dark rounded-lg p-3 bg-surface-raised dark:bg-surface-dark-raised">
                <div className="flex items-center justify-between mb-2">
                  <span className={`badge badge-sm ${statusBadge(log.status)}`}>{log.status}</span>
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
        message={`Are you sure you want to regenerate credentials? The old credentials will be invalidated immediately. Any systems using the old token or HMAC secret will stop working.`}
        confirmLabel="Regenerate"
        variant="warning"
        onConfirm={confirmRegenerate}
        onCancel={() => { setShowRegenerateModal(false); setWebhookToRegenerate(null); }}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Webhook?"
        message="Are you sure you want to delete this webhook? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDeleteWebhook}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};

export default WebhookManager;
