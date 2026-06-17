import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Settings,
  Plus,
  Layers,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '../components/atoms/Button';
import { Spinner } from '../components/atoms/Spinner';
import { Card } from '../components/molecules/Card';
import { EmptyState } from '../components/molecules/EmptyState';
import { ScopedEnvironmentList } from '../components/organisms/ScopedEnvironmentList';
import { EnvironmentForm } from '../components/organisms/EnvironmentForm';
import { EnvironmentProtectionPanel } from '../components/organisms/EnvironmentProtectionPanel';
import { PendingApprovalsList } from '../components/organisms/PendingApprovalsList';
import { ProtectionSummary } from '../components/organisms/ProtectionSummary';
import { authenticatedJson } from '../utils/authenticatedApi';
import { useAuth } from '../auth/useAuth';
import type {
  ScopedEnvironment,
  EnvironmentProtectionPolicy,
  EnvironmentProtectionUpdate,
  PendingApproval,
  EnvironmentFormData,
  ProtectionFormState,
  ReviewerOption,
  WorkspaceOption,
} from '../types';

type ViewMode = 'list' | 'create' | 'edit' | 'protection' | 'approvals';

export default function WorkspaceEnvironmentsPage() {
  const { orgSlug, workspaceSlug } = useParams<{ orgSlug: string; workspaceSlug: string }>();
  const { user } = useAuth();

  // Data state
  const [userEnvs, setUserEnvs] = useState<ScopedEnvironment[]>([]);
  const [orgEnvs, setOrgEnvs] = useState<ScopedEnvironment[]>([]);
  const [workspaceEnvs, setWorkspaceEnvs] = useState<ScopedEnvironment[]>([]);
  const [orgWorkspaces, setOrgWorkspaces] = useState<WorkspaceOption[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [protection, setProtection] = useState<EnvironmentProtectionPolicy | null>(null);
  const [reviewerOptions, setReviewerOptions] = useState<ReviewerOption[]>([]);

  // UI state
  const [selectedEnv, setSelectedEnv] = useState<ScopedEnvironment | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // IDs resolved from slugs (in a real app these would come from a lookup)
  const userId = user?.userId ?? '';
  const [orgId, setOrgId] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');

  // Resolve slugs to IDs
  useEffect(() => {
    async function resolveIds() {
      try {
        if (orgSlug) {
          const org = await authenticatedJson<{ orgId: string }>(`/api/orgs/by-slug/${orgSlug}`);
          setOrgId(org.orgId);
        }
        if (workspaceSlug) {
          const ws = await authenticatedJson<{ workspaceId: string }>(
            `/api/workspaces/by-slug/${workspaceSlug}`,
          );
          setWorkspaceId(ws.workspaceId);
        }
      } catch {
        // Slug resolution may not be available yet — use placeholder IDs
        setOrgId(orgSlug ?? 'org-placeholder');
        setWorkspaceId(workspaceSlug ?? 'ws-placeholder');
      }
    }
    void resolveIds();
  }, [orgSlug, workspaceSlug]);

  // Fetch all environments
  const fetchEnvironments = useCallback(async () => {
    if (!userId || !workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [userResult, orgResult, wsResult] = await Promise.all([
        authenticatedJson<ScopedEnvironment[]>(`/api/users/${userId}/environments`).catch(() => []),
        orgId
          ? authenticatedJson<ScopedEnvironment[]>(`/api/orgs/${orgId}/environments`).catch(() => [])
          : Promise.resolve([]),
        authenticatedJson<ScopedEnvironment[]>(`/api/workspaces/${workspaceId}/environments`).catch(
          () => [],
        ),
      ]);
      setUserEnvs(userResult);
      setOrgEnvs(orgResult);
      setWorkspaceEnvs(wsResult);

      // Fetch pending approvals for workspace
      const approvals = await authenticatedJson<PendingApproval[]>(
        `/api/workspaces/${workspaceId}/pending-approvals`,
      ).catch(() => []);
      setPendingApprovals(approvals);

      // Fetch org workspaces for allowed-workspace selector
      if (orgId) {
        const wsList = await authenticatedJson<Array<{ workspaceId: string; name: string; slug: string }>>(
          `/api/orgs/${orgId}/workspaces`,
        ).catch(() => []);
        setOrgWorkspaces(wsList.map((w) => ({ workspaceId: w.workspaceId, name: w.name, slug: w.slug })));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load environments');
    } finally {
      setLoading(false);
    }
  }, [userId, orgId, workspaceId]);

  useEffect(() => {
    void fetchEnvironments();
  }, [fetchEnvironments]);

  // Fetch protection for selected env
  useEffect(() => {
    async function fetchProtection() {
      if (!selectedEnv || selectedEnv.scopeType !== 'workspace' || !workspaceId) {
        setProtection(null);
        return;
      }
      try {
        const result = await authenticatedJson<EnvironmentProtectionPolicy | { status: string }>(
          `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}/protection`,
        );
        if ('status' in result && result.status === 'unprotected') {
          setProtection(null);
        } else {
          setProtection(result as EnvironmentProtectionPolicy);
        }
      } catch {
        setProtection(null);
      }
    }
    void fetchProtection();
  }, [selectedEnv, workspaceId]);

  // Build reviewer options from org members (simplified — in production would fetch members)
  useEffect(() => {
    const options: ReviewerOption[] = [];
    if (user) {
      options.push({
        id: user.userId,
        name: user.verified_email ?? user.userId,
        type: 'user',
      });
    }
    setReviewerOptions(options);
  }, [user]);

  // ---- CRUD Handlers ----

  async function handleCreateEnv(data: EnvironmentFormData) {
    if (!workspaceId) return;
    setSaving(true);
    try {
      await authenticatedJson<ScopedEnvironment>(`/api/workspaces/${workspaceId}/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description || undefined,
          swaggerDocUrl: data.swaggerDocUrl || undefined,
          allowedWorkspaceIds: data.allowedWorkspaceIds,
        }),
      });
      setViewMode('list');
      await fetchEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateEnv(data: EnvironmentFormData) {
    if (!selectedEnv || !workspaceId) return;
    setSaving(true);
    try {
      const endpoint =
        selectedEnv.scopeType === 'workspace'
          ? `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}`
          : selectedEnv.scopeType === 'organization'
            ? `/api/orgs/${selectedEnv.scopeId}/environments/${selectedEnv.environmentId}`
            : `/api/users/${selectedEnv.scopeId}/environments/${selectedEnv.environmentId}`;

      await authenticatedJson<ScopedEnvironment>(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          description: data.description || undefined,
          swaggerDocUrl: data.swaggerDocUrl || undefined,
          allowedWorkspaceIds: data.allowedWorkspaceIds,
        }),
      });
      setViewMode('list');
      setSelectedEnv(null);
      await fetchEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update environment');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteEnv(env: ScopedEnvironment) {
    if (!workspaceId) return;
    if (env.isDefault) {
      setError('Cannot delete the default workspace environment');
      return;
    }
    try {
      const endpoint =
        env.scopeType === 'workspace'
          ? `/api/workspaces/${workspaceId}/environments/${env.environmentId}`
          : env.scopeType === 'organization'
            ? `/api/orgs/${env.scopeId}/environments/${env.environmentId}`
            : `/api/users/${env.scopeId}/environments/${env.environmentId}`;

      await authenticatedJson(endpoint, { method: 'DELETE' });
      if (selectedEnv?.environmentId === env.environmentId) {
        setSelectedEnv(null);
        setViewMode('list');
      }
      await fetchEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete environment');
    }
  }

  async function handleSaveProtection(update: ProtectionFormState) {
    if (!selectedEnv || !workspaceId) return;
    setSaving(true);
    try {
      const body: EnvironmentProtectionUpdate = {
        requiredReviewers: update.requiredReviewers,
        allowSelfApproval: update.allowSelfApproval,
        bypassPolicy: update.bypassPolicy,
        bypassAllowlist: update.bypassAllowlist,
      };
      await authenticatedJson<EnvironmentProtectionPolicy>(
        `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}/protection`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      // Re-fetch protection
      const result = await authenticatedJson<EnvironmentProtectionPolicy>(
        `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}/protection`,
      );
      setProtection(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save protection');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveProtection() {
    if (!selectedEnv || !workspaceId) return;
    setSaving(true);
    try {
      await authenticatedJson(
        `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}/protection`,
        { method: 'DELETE' },
      );
      setProtection(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove protection');
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(approvalId: string) {
    if (!selectedEnv || !workspaceId) return;
    try {
      await authenticatedJson(
        `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}/approvals/${approvalId}/approve`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      await fetchEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  }

  async function handleDeny(approvalId: string) {
    // Deny = delete the approval (or mark rejected)
    if (!selectedEnv || !workspaceId) return;
    try {
      await authenticatedJson(
        `/api/workspaces/${workspaceId}/environments/${selectedEnv.environmentId}/approvals/${approvalId}`,
        { method: 'DELETE' },
      );
      await fetchEnvironments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deny');
    }
  }

  function handleSelectEnv(env: ScopedEnvironment) {
    setSelectedEnv(env);
    setViewMode('list');
  }

  // ---- Render ----

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border dark:border-border-dark">
        <button
          type="button"
          onClick={() => {
            setViewMode('list');
            setSelectedEnv(null);
          }}
          className="p-1.5 rounded-lg text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <Settings className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
        <div>
          <h1 className="text-lg font-bold font-display text-text-primary dark:text-text-primary-dark">
            Environments
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            {orgSlug && workspaceSlug
              ? `${orgSlug} / ${workspaceSlug}`
              : 'Manage scoped environments and protection policies'}
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 p-3 rounded-lg bg-status-error/10 dark:bg-status-error/20 border border-status-error/30 text-sm text-status-error">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline cursor-pointer text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Create mode */}
        {viewMode === 'create' && (
          <EnvironmentForm
            onSubmit={handleCreateEnv}
            onCancel={() => setViewMode('list')}
            submitting={saving}
            availableWorkspaces={orgWorkspaces}
            showAllowedWorkspaces={false}
          />
        )}

        {/* Edit mode */}
        {viewMode === 'edit' && selectedEnv && (
          <EnvironmentForm
            environment={selectedEnv}
            onSubmit={handleUpdateEnv}
            onCancel={() => setViewMode('list')}
            submitting={saving}
            availableWorkspaces={orgWorkspaces}
            showAllowedWorkspaces={selectedEnv.scopeType === 'organization'}
          />
        )}

        {/* Protection mode */}
        {viewMode === 'protection' && selectedEnv && (
          <EnvironmentProtectionPanel
            environmentId={selectedEnv.environmentId}
            protection={protection}
            reviewerOptions={reviewerOptions}
            onSave={handleSaveProtection}
            onRemove={handleRemoveProtection}
            saving={saving}
          />
        )}

        {/* List mode */}
        {viewMode === 'list' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Environment lists by scope */}
            <div className="lg:col-span-2 space-y-6">
              {/* Create button */}
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  intent="success"
                  size="sm"
                  icon={<Plus className="w-4 h-4" />}
                  onClick={() => setViewMode('create')}
                >
                  New Environment
                </Button>
              </div>

              {/* Workspace environments */}
              <ScopedEnvironmentList
                environments={workspaceEnvs}
                scopeType="workspace"
                title="Workspace Environments"
                onSelect={handleSelectEnv}
                onCreate={() => setViewMode('create')}
                onEdit={(env) => {
                  setSelectedEnv(env);
                  setViewMode('edit');
                }}
                onDelete={handleDeleteEnv}
                selectedId={selectedEnv?.environmentId}
              />

              {/* Organization environments */}
              {orgId && (
                <ScopedEnvironmentList
                  environments={orgEnvs}
                  scopeType="organization"
                  title="Organization Environments"
                  onSelect={handleSelectEnv}
                  onEdit={(env) => {
                    setSelectedEnv(env);
                    setViewMode('edit');
                  }}
                  onDelete={handleDeleteEnv}
                  selectedId={selectedEnv?.environmentId}
                />
              )}

              {/* User environments */}
              <ScopedEnvironmentList
                environments={userEnvs}
                scopeType="user"
                title="User Environments"
                onSelect={handleSelectEnv}
                onEdit={(env) => {
                  setSelectedEnv(env);
                  setViewMode('edit');
                }}
                onDelete={handleDeleteEnv}
                selectedId={selectedEnv?.environmentId}
              />
            </div>

            {/* Right: Selected env details */}
            <div className="space-y-4">
              {selectedEnv ? (
                <>
                  {/* Env details card */}
                  <Card title={selectedEnv.name}>
                    <div className="space-y-3">
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">
                          Description
                        </span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {selectedEnv.description || 'No description'}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">
                          Variables
                        </span>
                        <p className="text-sm text-text-primary dark:text-text-primary-dark">
                          {Object.keys(selectedEnv.variables).length} variable
                          {Object.keys(selectedEnv.variables).length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      {selectedEnv.allowedWorkspaceIds.length > 0 && (
                        <div>
                          <span className="text-xs text-text-muted dark:text-text-muted-dark">
                            Allowed Workspaces
                          </span>
                          <p className="text-sm text-text-primary dark:text-text-primary-dark">
                            {selectedEnv.allowedWorkspaceIds.length} workspace
                            {selectedEnv.allowedWorkspaceIds.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Protection summary (workspace envs only) */}
                  {selectedEnv.scopeType === 'workspace' && (
                    <>
                      <ProtectionSummary
                        protection={protection}
                        onEdit={() => setViewMode('protection')}
                      />

                      {/* Pending approvals */}
                      <PendingApprovalsList
                        approvals={pendingApprovals.filter(
                          (a) => a.environmentId === selectedEnv.environmentId,
                        )}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                        currentUserId={userId}
                        requiredReviewerIds={protection?.requiredReviewers}
                      />
                    </>
                  )}
                </>
              ) : (
                <EmptyState
                  icon={<Layers className="w-12 h-12 text-text-muted" strokeWidth={1.5} />}
                  title="Select an environment"
                  description="Choose an environment from the list to view details, configure protection, or manage approvals."
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
