import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Users, UserPlus, Mail, Building2 } from "lucide-react";
import { Spinner } from "../components/atoms/Spinner";
import { EmptyState } from "../components/molecules/EmptyState";
import { PanelTabs } from "../components/molecules/PanelTabs";
import { OrgMembersSection } from "../components/organisms/OrgMembersSection";
import { OrgTeamsSection } from "../components/organisms/OrgTeamsSection";
import { OrgInvitesSection } from "../components/organisms/OrgInvitesSection";
import { authenticatedJson } from "../utils/apiweaveClient";
import API_BASE_URL from "../utils/apiweaveClient";
import type { Organization } from "../types";
import { toast } from "sonner";
import { useAuth } from "../auth/useAuth";

type OrgSettingsTab = "general" | "members" | "teams" | "invites";

const TABS = [
  { key: "general" as const, icon: Building2, label: "General" },
  { key: "members" as const, icon: Users, label: "Members" },
  { key: "teams" as const, icon: UserPlus, label: "Teams" },
  { key: "invites" as const, icon: Mail, label: "Invites" },
];

export default function OrgSettingsPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<OrgSettingsTab>("general");
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
      const msg =
        err instanceof Error ? err.message : "Failed to load organization";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    void fetchOrg();
  }, [fetchOrg]);

  const renderHeader = (title: string, subtitle: string) => (
    <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
      <Building2
        className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark"
        aria-hidden="true"
      />
      <div>
        <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
          {title}
        </h1>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
          {subtitle}
        </p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        {renderHeader(
          "Organization",
          "Manage organization members, teams, and invites",
        )}
        <div className="flex-1 flex items-center justify-center">
          <Spinner size="lg" className="text-primary dark:text-primary-light" />
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="flex flex-col h-full">
        {renderHeader(
          "Organization",
          "Manage organization members, teams, and invites",
        )}
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState
            icon={
              <Building2
                className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
                strokeWidth={1.5}
              />
            }
            title="Organization not found"
            description={error ?? "The organization could not be loaded."}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {renderHeader(
        org.name,
        `${org.slug ? `/${org.slug}` : ""}${org.description ? ` — ${org.description}` : ""}`,
      )}

      {error && (
        <div className="mx-6 mt-4 p-3 rounded bg-status-error/10 dark:bg-status-error/20 border border-status-error/30 text-sm text-status-error">
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

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="border border-border dark:border-border-dark rounded bg-surface-raised dark:bg-surface-dark-raised overflow-hidden">
            <PanelTabs
              tabs={TABS.map((t) => ({
                key: t.key,
                icon: t.icon,
                label: t.label,
              }))}
              activeTab={activeTab}
              onTabChange={(key) => setActiveTab(key as OrgSettingsTab)}
            />

            <div className="p-5">
              {activeTab === "general" && (
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
                        {org.description ?? "No description"}
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

              {activeTab === "members" && (
                <OrgMembersSection
                  orgSlug={org.slug}
                  orgId={org.orgId}
                  currentUserId={user?.userId ?? ""}
                />
              )}

              {activeTab === "teams" && (
                <OrgTeamsSection orgSlug={org.slug} orgId={org.orgId} />
              )}

              {activeTab === "invites" && (
                <OrgInvitesSection orgSlug={org.slug} orgId={org.orgId} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
