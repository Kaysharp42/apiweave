import React, { useState, useEffect } from 'react';
import { Copy, Trash2, Pencil, RefreshCw, Eye, EyeOff, ExternalLink } from 'lucide-react';
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
    resourceType: 'workflow',
    resourceId: '',
    environmentId: '',
    description: '',
  });
  const [webhookCredentials, setWebhookCredentials] = useState(null);
  const [selectedWebhook, setSelectedWebhook] = useState(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [webhookToRegenerate, setWebhookToRegenerate] = useState(null);
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [copySuccess, setCopySuccess] = useState({});

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    try {
      // Fetch workflows, collections, and environments first
      const [workflowsData, collectionsData, environmentsData] = await Promise.all([
        fetchWorkflows(),
        fetchCollections(),
        fetchEnvironments(),
      ]);
      
      // Now fetch webhooks using the loaded data
      await fetchAllWebhooksWithData(workflowsData || [], collectionsData || []);
    } catch (error) {
      console.error('Error loading webhook data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflows = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/workflows`);
      if (response.ok) {
        const data = await response.json();
        // Handle paginated response format
        const workflowsList = Array.isArray(data) ? data : data.workflows || [];
        setWorkflows(workflowsList);
        return workflowsList;
      }
    } catch (error) {
      console.error('Error fetching workflows:', error);
    }
    return [];
  };

  const fetchCollections = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/collections`);
      if (response.ok) {
        const data = await response.json();
        const collectionsList = Array.isArray(data) ? data : [];
        setCollections(collectionsList);
        return collectionsList;
      }
    } catch (error) {
      console.error('Error fetching collections:', error);
    }
    return [];
  };

  const fetchEnvironments = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/environments`);
      if (response.ok) {
        const data = await response.json();
        const environmentsList = Array.isArray(data) ? data : [];
        setEnvironments(environmentsList);
        return environmentsList;
      }
    } catch (error) {
      console.error('Error fetching environments:', error);
    }
    return [];
  };

  const fetchAllWebhooksWithData = async (workflowsList, collectionsList) => {
    try {
      console.log('Fetching webhooks for:', {
        workflows: workflowsList.length,
        collections: collectionsList.length
      });
      
      const allWebhooks = [];
      
      // Fetch webhooks for all workflows
      for (const workflow of workflowsList) {
        const response = await fetch(`${API_BASE_URL}/api/webhooks/workflows/${workflow.workflowId}`);
        if (response.ok) {
          const data = await response.json();
          allWebhooks.push(...(Array.isArray(data) ? data : []));
        }
      }

      // Fetch webhooks for all collections
      for (const collection of collectionsList) {
        const response = await fetch(`${API_BASE_URL}/api/webhooks/collections/${collection.collectionId}`);
        if (response.ok) {
          const data = await response.json();
          allWebhooks.push(...(Array.isArray(data) ? data : []));
        }
      }

      console.log('Found webhooks:', allWebhooks.length);
      setWebhooks(allWebhooks);
    } catch (error) {
      console.error('Error fetching webhooks:', error);
    }
  };

  const fetchAllWebhooks = async () => {
    // Use current state values
    await fetchAllWebhooksWithData(workflows || [], collections || []);
  };

  const createWebhook = async () => {
    if (!newWebhookData.resourceId) {
      alert('Please select a workflow or collection');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newWebhookData),
      });

      if (response.ok) {
        const data = await response.json();
        setWebhookCredentials(data);
        setShowCredentialsModal(true);
        setShowCreateModal(false);
        setNewWebhookData({
          resourceType: 'workflow',
          resourceId: '',
          environmentId: '',
          description: '',
        });
        await fetchAllWebhooks();
      } else {
        const error = await response.json();
        alert(`Failed to create webhook: ${error.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating webhook:', error);
      alert('Error creating webhook');
    }
  };

  const deleteWebhook = async (webhookId) => {
    if (!confirm('Are you sure you want to delete this webhook? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/${webhookId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchAllWebhooks();
      } else {
        alert('Failed to delete webhook');
      }
    } catch (error) {
      console.error('Error deleting webhook:', error);
      alert('Error deleting webhook');
    }
  };

  const toggleWebhook = async (webhook) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/${webhook.webhookId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });

      if (response.ok) {
        await fetchAllWebhooks();
      } else {
        alert('Failed to update webhook');
      }
    } catch (error) {
      console.error('Error updating webhook:', error);
      alert('Error updating webhook');
    }
  };

  const initiateRegenerate = (webhook) => {
    setWebhookToRegenerate(webhook);
    setShowRegenerateModal(true);
  };

  const confirmRegenerate = async () => {
    if (!webhookToRegenerate) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/${webhookToRegenerate.webhookId}/regenerate-token`, {
        method: 'POST',
      });

      if (response.ok) {
        const data = await response.json();
        setWebhookCredentials(data);
        setShowCredentialsModal(true);
        setShowRegenerateModal(false);
        setWebhookToRegenerate(null);
        await fetchAllWebhooks();
      } else {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        alert(`Failed to regenerate credentials: ${errorData.detail || 'Unknown error'}`);
        setShowRegenerateModal(false);
        setWebhookToRegenerate(null);
      }
    } catch (error) {
      console.error('Error regenerating credentials:', error);
      alert(`Error regenerating credentials: ${error.message}`);
      setShowRegenerateModal(false);
      setWebhookToRegenerate(null);
    }
  };

  const cancelRegenerate = () => {
    setShowRegenerateModal(false);
    setWebhookToRegenerate(null);
  };

  const viewLogs = async (webhook) => {
    setSelectedWebhook(webhook);
    setShowLogsModal(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/webhooks/${webhook.webhookId}/logs?limit=50`);
      if (response.ok) {
        const data = await response.json();
        setWebhookLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Error fetching webhook logs:', error);
    }
  };

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess({ ...copySuccess, [key]: true });
      setTimeout(() => {
        setCopySuccess({ ...copySuccess, [key]: false });
      }, 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const getResourceName = (webhook) => {
    if (webhook.resourceType === 'workflow') {
      const workflow = (workflows || []).find(w => w.workflowId === webhook.resourceId);
      return workflow?.name || webhook.resourceId;
    } else {
      const collection = (collections || []).find(c => c.collectionId === webhook.resourceId);
      return collection?.name || webhook.resourceId;
    }
  };

  const getEnvironmentName = (environmentId) => {
    if (!environmentId) return 'None';
    const env = (environments || []).find(e => e.environmentId === environmentId);
    return env?.name || environmentId;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const getStatusBadge = (status) => {
    const colors = {
      success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    };
    return colors[status] || colors.pending;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading webhooks...</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Webhooks
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            + Create Webhook
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Manage CI/CD webhooks for workflows and collections
        </p>
      </div>

      {/* Webhooks List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {webhooks.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p className="text-sm">No webhooks created yet.</p>
            <p className="text-xs mt-2">Create a webhook to integrate with CI/CD pipelines.</p>
          </div>
        ) : (
          webhooks.map((webhook) => (
            <div
              key={webhook.webhookId}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900"
            >
              {/* Webhook Header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                      {getResourceName(webhook)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      webhook.resourceType === 'workflow'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                    }`}>
                      {webhook.resourceType}
                    </span>
                    <button
                      onClick={() => toggleWebhook(webhook)}
                      className={`text-xs px-2 py-0.5 rounded ${
                        webhook.enabled
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>
                  {webhook.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">{webhook.description}</p>
                  )}
                </div>
              </div>

              {/* Webhook Info */}
              <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400 mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">Environment:</span>
                  <span>{getEnvironmentName(webhook.environmentId)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Last Used:</span>
                  <span>{formatDate(webhook.lastUsed)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Usage Count:</span>
                  <span>{webhook.usageCount}</span>
                  {webhook.lastStatus && (
                    <>
                      <span>•</span>
                      <span className={`px-2 py-0.5 rounded ${getStatusBadge(webhook.lastStatus)}`}>
                        {webhook.lastStatus}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Webhook URL */}
              <div className="mb-2">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Webhook URL:</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhook.url}
                    className="flex-1 text-xs px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded"
                  />
                  <button
                    onClick={() => copyToClipboard(webhook.url, `url-${webhook.webhookId}`)}
                    className="p-1 text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                    title="Copy URL"
                  >
                    {copySuccess[`url-${webhook.webhookId}`] ? (
                      <span className="text-green-600 text-xs">✓</span>
                    ) : (
                      <Copy size={14} />
                    )}
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <button
                  onClick={() => viewLogs(webhook)}
                  className="text-xs px-2 py-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                >
                  View Logs
                </button>
                <button
                  onClick={() => initiateRegenerate(webhook)}
                  className="text-xs px-2 py-1 text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-900/20 rounded transition-colors"
                >
                  <RefreshCw className="inline mr-1" size={12} />
                  Regenerate
                </button>
                <button
                  onClick={() => deleteWebhook(webhook.webhookId)}
                  className="text-xs px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                >
                  <Trash2 className="inline mr-1" size={12} />
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Webhook Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Create Webhook
            </h3>

            <div className="space-y-4">
              {/* Resource Type */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Resource Type
                </label>
                <select
                  value={newWebhookData.resourceType}
                  onChange={(e) => setNewWebhookData({ ...newWebhookData, resourceType: e.target.value, resourceId: '' })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  <option value="workflow">Workflow</option>
                  <option value="collection">Collection</option>
                </select>
              </div>

              {/* Resource Selection */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  {newWebhookData.resourceType === 'workflow' ? 'Workflow' : 'Collection'}
                </label>
                <select
                  value={newWebhookData.resourceId}
                  onChange={(e) => setNewWebhookData({ ...newWebhookData, resourceId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  <option value="">Select {newWebhookData.resourceType}...</option>
                  {newWebhookData.resourceType === 'workflow'
                    ? (workflows || []).map((w) => (
                        <option key={w.workflowId} value={w.workflowId}>
                          {w.name}
                        </option>
                      ))
                    : (collections || []).map((c) => (
                        <option key={c.collectionId} value={c.collectionId}>
                          {c.name}
                        </option>
                      ))}
                </select>
              </div>

              {/* Environment */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Environment (Optional)
                </label>
                <select
                  value={newWebhookData.environmentId}
                  onChange={(e) => setNewWebhookData({ ...newWebhookData, environmentId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                >
                  <option value="">None</option>
                  {(environments || []).map((env) => (
                    <option key={env.environmentId} value={env.environmentId}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Description (Optional)
                </label>
                <input
                  type="text"
                  value={newWebhookData.description}
                  onChange={(e) => setNewWebhookData({ ...newWebhookData, description: e.target.value })}
                  placeholder="e.g., Production deployment webhook"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button
                onClick={createWebhook}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewWebhookData({
                    resourceType: 'workflow',
                    resourceId: '',
                    environmentId: '',
                    description: '',
                  });
                }}
                className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Credentials Modal */}
      {showCredentialsModal && webhookCredentials && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4">
            <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
              Webhook Credentials
            </h3>
            <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                ⚠️ <strong>Important:</strong> Copy these credentials now. They will not be shown again!
              </p>
            </div>

            <div className="space-y-4">
              {/* Webhook URL */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Webhook URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookCredentials.url}
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded font-mono text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookCredentials.url, 'cred-url')}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {copySuccess['cred-url'] ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Token */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  Webhook Token (X-Webhook-Token header)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookCredentials.token}
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded font-mono text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookCredentials.token, 'cred-token')}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {copySuccess['cred-token'] ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* HMAC Secret */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  HMAC Secret (for signature validation)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={webhookCredentials.hmacSecret}
                    className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded font-mono text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookCredentials.hmacSecret, 'cred-hmac')}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    {copySuccess['cred-hmac'] ? '✓' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Usage Example */}
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
                  cURL Example
                </label>
                <pre className="text-xs bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-3 overflow-x-auto">
{`curl -X POST "${webhookCredentials.url}" \\
  -H "X-Webhook-Token: ${webhookCredentials.token}" \\
  -H "Content-Type: application/json" \\
  -d '{}'`}
                </pre>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => {
                  setShowCredentialsModal(false);
                  setWebhookCredentials(null);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                I've Saved the Credentials
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {showLogsModal && selectedWebhook && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Webhook Execution Logs
              </h3>
              <button
                onClick={() => {
                  setShowLogsModal(false);
                  setSelectedWebhook(null);
                  setWebhookLogs([]);
                }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {webhookLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  No execution logs yet
                </div>
              ) : (
                <div className="space-y-2">
                  {webhookLogs.map((log) => (
                    <div
                      key={log.logId}
                      className="border border-gray-200 dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-900"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(log.status)}`}>
                          {log.status}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(log.timestamp)}
                        </span>
                      </div>
                      {log.duration && (
                        <div className="text-xs text-gray-600 dark:text-gray-400">
                          Duration: {(log.duration / 1000).toFixed(2)}s
                        </div>
                      )}
                      {log.errorMessage && (
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                          Error: {log.errorMessage}
                        </div>
                      )}
                      {log.runId && (
                        <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                          Run ID: {log.runId}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Credentials Confirmation Modal */}
      {showRegenerateModal && webhookToRegenerate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/30 rounded-full">
                  <RefreshCw className="text-orange-600 dark:text-orange-400" size={24} />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Regenerate Credentials?
                </h3>
              </div>

              <div className="mb-6 space-y-3">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Are you sure you want to regenerate credentials for webhook <strong>{webhookToRegenerate.name}</strong>?
                </p>
                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded p-3">
                  <p className="text-sm text-orange-800 dark:text-orange-300">
                    ⚠️ <strong>Warning:</strong> The old credentials will be invalidated immediately. Any systems using the old token or HMAC secret will stop working.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={cancelRegenerate}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRegenerate}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw size={18} />
                  Regenerate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WebhookManager;
