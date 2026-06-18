import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Settings,
  Users,
  UserPlus,
  Mail,
  Building2,
} from 'lucide-react';
import { Spinner } from '../components/atoms/Spinner';
import { PanelTabs } from '../components/molecules/PanelTabs';
import { OrgMembersSection } from '../components/organisms/OrgMembersSection';
import { OrgTeamsSection } from '../components/organisms/OrgTeamsSection';
import { OrgInvitesSection } from '../components/organisms/OrgInvitesSection';
import { authenticatedJson } from '../utils/authenticatedApi';
import API_BASE_URL from '../utils/api';
import type { Organization } from '../types';
import { toast } from 'sonner';
import { useAuth } from '../auth/useAuth';

type OrgSettingsTab = 'general' | 'members' | 'teams' | 'invites';

const TABS = [
  { key: 'general' as const, icon: Building2, label: 'General' },
  { key: 'members' as const, icon: Users, label: 'Members' },
  { key: 'teams' as const, icon: UserPlus, label: 'Teams' },
  { key: 'invites' as const, icon: Mail, label: 'Invites' },
];

export default function OrgSettingsPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<OrgSettingsTab>('general');
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrg = useCallback(async () => {
    if (!orgSlug) return;
    try {
      setLoading(true);
      setError(null);
      const data = await authenticatedJson<Organization>(
        `${API_BASE_URL}/api/orgs/${orgSlug}`,
      );
      setOrg(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load organization';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    void fetchOrg();
  }, [fetchOrg]);

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center p-8">
        <Spinner size="lg" className="text-primary dark:text-primary-light" />
      </main>
    );
  }

  if (error || !org) {
    return (
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Settings className="w-10 h-10 text-text-muted mx-auto" />
          <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
            Organization not found
          </h2>
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            {error ?? 'The organization could not be loaded.'}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 pb-6 border-b border-border dark:border-border-dark">
          <div className="w-10 h-10 rounded border border-border dark:border-border-dark bg-primary/10 dark:bg-primary-light/20 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-primary dark:text-primary-light" />
          </div>
          <div>
            <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              {org.name}
            </h1>
            <p className="text-xs text-text-muted dark:text-text-muted-dark">
              /{org.slug}
              {org.description && ` — ${org.description}`}
            </p>
          </div>
        </div>

        {/* Tabs */}
          <div className="border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised overflow-hidden">
          <PanelTabs
            tabs={TABS.map((t) => ({ key: t.key, icon: t.icon, label: t.label }))}
            activeTab={activeTab}
            onTabChange={(key) => setActiveTab(key as OrgSettingsTab)}
          />

          <div className="p-5">
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark mb-1">
                    Organization Details
                  </h3>
                  <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
                    Manage your organization settings.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark block">
                      Name
                    </span>
                    <span className="text-text-primary dark:text-text-primary-dark font-medium">
                      {org.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark block">
                      Slug
                    </span>
                    <span className="font-mono text-text-primary dark:text-text-primary-dark">
                      {org.slug}
                    </span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-xs text-text-muted dark:text-text-muted-dark block">
                      Description
                    </span>
                    <span className="text-text-secondary dark:text-text-secondary-dark">
                      {org.description ?? 'No description'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark block">
                      Created
                    </span>
                    <span className="text-text-secondary dark:text-text-secondary-dark">
                      {new Date(org.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <OrgMembersSection
                orgSlug={org.slug}
                orgId={org.orgId}
                currentUserId={user?.userId ?? ''}
              />
            )}

            {activeTab === 'teams' && (
              <OrgTeamsSection orgSlug={org.slug} orgId={org.orgId} />
            )}

            {activeTab === 'invites' && (
              <OrgInvitesSection orgSlug={org.slug} orgId={org.orgId} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
