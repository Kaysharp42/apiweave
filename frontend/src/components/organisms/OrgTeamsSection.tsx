import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  Shield,
} from "lucide-react";
import { Button } from "../atoms/Button";
import { IconButton } from "../atoms/IconButton";
import { Spinner } from "../atoms/Spinner";
import { Input } from "../atoms/Input";
import { Badge } from "../atoms/Badge";
import { EmptyState } from "../molecules/EmptyState";
import { Panel } from "../molecules/Panel";
import { Modal } from "../molecules/Modal";
import { FormField } from "../molecules/FormField";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { TeamPermissionRow } from "../molecules/TeamPermissionRow";
import {
  authenticatedJson,
  authenticatedFetch,
} from "../../utils/authenticatedApi";
import API_BASE_URL from "../../utils/api";
import type { Team, TeamMember, TeamPermissionGrant } from "../../types";
import { toast } from "sonner";

export interface OrgTeamsSectionProps {
  orgSlug: string;
  orgId: string;
}

interface TeamExpanded {
  team: Team;
  members: TeamMember[];
  grants: TeamPermissionGrant[];
  membersLoading: boolean;
  grantsLoading: boolean;
}

export function OrgTeamsSection({ orgSlug }: OrgTeamsSectionProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [expandedData, setExpandedData] = useState<TeamExpanded | null>(null);

  // Create team modal
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Rename modal
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTeam, setRenameTeam] = useState<Team | null>(null);
  const [renameName, setRenameName] = useState("");

  // Delete confirm
  const [deleteConfirm, setDeleteConfirm] = useState<Team | null>(null);

  // Add grant modal
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantResourceType, setGrantResourceType] = useState("workspace");
  const [grantResourceId, setGrantResourceId] = useState("");
  const [grantPermissions, setGrantPermissions] = useState("write");

  const fetchTeams = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<Team[]>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams`,
      );
      setTeams(data);
    } catch {
      toast.error("Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    void fetchTeams();
  }, [fetchTeams]);

  const toggleExpand = async (team: Team) => {
    if (expandedSlug === team.slug) {
      setExpandedSlug(null);
      setExpandedData(null);
      return;
    }
    setExpandedSlug(team.slug);
    setExpandedData({
      team,
      members: [],
      grants: [],
      membersLoading: true,
      grantsLoading: true,
    });

    // Fetch members and grants in parallel
    const [members, grants] = await Promise.all([
      authenticatedJson<TeamMember[]>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams/${team.slug}/members`,
      ).catch(() => [] as TeamMember[]),
      authenticatedJson<TeamPermissionGrant[]>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams/${team.slug}/grants`,
      ).catch(() => [] as TeamPermissionGrant[]),
    ]);

    setExpandedData({
      team,
      members,
      grants,
      membersLoading: false,
      grantsLoading: false,
    });
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreating(true);
    try {
      const created = await authenticatedJson<Team>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newName.trim(),
            slug: newSlug.trim(),
            description: newDesc.trim() || null,
          }),
        },
      );
      setTeams((prev) => [...prev, created]);
      toast.success("Team created");
      setCreateOpen(false);
      setNewName("");
      setNewSlug("");
      setNewDesc("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTeam || !renameName.trim()) return;
    try {
      const updated = await authenticatedJson<Team>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams/${renameTeam.slug}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: renameName.trim() }),
        },
      );
      setTeams((prev) =>
        prev.map((t) => (t.teamId === renameTeam.teamId ? updated : t)),
      );
      toast.success("Team renamed");
      setRenameOpen(false);
      setRenameTeam(null);
      setRenameName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename team");
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteConfirm) return;
    try {
      await authenticatedFetch(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams/${deleteConfirm.slug}`,
        { method: "DELETE" },
      );
      setTeams((prev) => prev.filter((t) => t.teamId !== deleteConfirm.teamId));
      if (expandedSlug === deleteConfirm.slug) {
        setExpandedSlug(null);
        setExpandedData(null);
      }
      toast.success("Team deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete team");
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    if (!expandedSlug || !expandedData) return;
    try {
      await authenticatedFetch(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams/${expandedSlug}/grants/${grantId}`,
        { method: "DELETE" },
      );
      setExpandedData((prev) =>
        prev
          ? {
              ...prev,
              grants: prev.grants.filter((g) => g.grantId !== grantId),
            }
          : prev,
      );
      toast.success("Permission revoked");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke");
    }
  };

  const handleAddGrant = async () => {
    if (!expandedSlug || !grantResourceId.trim()) return;
    try {
      const grant = await authenticatedJson<TeamPermissionGrant>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/teams/${expandedSlug}/grants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resource_type: grantResourceType,
            resource_id: grantResourceId.trim(),
            permissions: grantPermissions
              .split(",")
              .map((p) => p.trim())
              .filter(Boolean),
          }),
        },
      );
      setExpandedData((prev) =>
        prev ? { ...prev, grants: [...prev.grants, grant] } : prev,
      );
      toast.success("Permission granted");
      setGrantOpen(false);
      setGrantResourceId("");
      setGrantPermissions("write");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add permission",
      );
    }
  };

  return (
    <>
      <Panel
        title="Teams"
        icon={Users}
        headerActions={
          <Button size="xs" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            New Team
          </Button>
        }
      >
        {loading ? (
          <div className="flex justify-center p-12">
            <Spinner
              size="lg"
              className="text-primary dark:text-primary-light"
            />
          </div>
        ) : teams.length === 0 ? (
          <EmptyState
            title="No teams"
            description="Create a team to group members and assign permissions."
            action={
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Create Team
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border dark:divide-border-dark">
            {teams.map((team) => {
              const isExpanded = expandedSlug === team.slug;
              return (
                <div key={team.teamId}>
                  <div
                    className="flex items-center justify-between px-4 py-3 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer"
                    onClick={() => toggleExpand(team)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleExpand(team);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted flex-shrink-0" />
                      )}
                      <Users className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-text-primary dark:text-text-primary-dark truncate block">
                          {team.name}
                        </span>
                        {team.description && (
                          <span className="text-xs text-text-muted dark:text-text-muted-dark truncate block">
                            {team.description}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <IconButton
                        tooltip="Rename team"
                        size="xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenameTeam(team);
                          setRenameName(team.name);
                          setRenameOpen(true);
                        }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </IconButton>
                      <IconButton
                        tooltip="Delete team"
                        size="xs"
                        variant="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(team);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </IconButton>
                    </div>
                  </div>

                  {isExpanded && expandedData && (
                    <div className="px-4 pb-4 space-y-3 bg-surface-overlay/50 dark:bg-surface-dark-overlay/50">
                      {/* Members */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase">
                            Members ({expandedData.members.length})
                          </span>
                        </div>
                        {expandedData.membersLoading ? (
                          <Spinner size="sm" className="text-primary" />
                        ) : expandedData.members.length === 0 ? (
                          <p className="text-xs text-text-muted dark:text-text-muted-dark italic">
                            No members in this team.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {expandedData.members.map((m) => (
                              <div
                                key={m.memberId}
                                className="flex items-center justify-between text-xs py-1"
                              >
                                <span className="font-mono text-text-primary dark:text-text-primary-dark">
                                  {m.userId.slice(0, 8)}…
                                </span>
                                <Badge variant="default" size="xs">
                                  {m.role}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Permission Grants */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-text-secondary dark:text-text-secondary-dark uppercase">
                            Permissions ({expandedData.grants.length})
                          </span>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setGrantOpen(true)}
                          >
                            <Shield className="w-3 h-3" />
                            Add
                          </Button>
                        </div>
                        {expandedData.grantsLoading ? (
                          <Spinner size="sm" className="text-primary" />
                        ) : expandedData.grants.length === 0 ? (
                          <p className="text-xs text-text-muted dark:text-text-muted-dark italic">
                            No permissions granted.
                          </p>
                        ) : (
                          <table className="w-full text-xs text-left border-collapse border border-border dark:border-border-dark">
                            <thead className="text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
                              <tr>
                                <th className="px-4 py-1.5">Type</th>
                                <th className="px-4 py-1.5">Resource</th>
                                <th className="px-4 py-1.5">Permissions</th>
                                <th className="px-4 py-1.5" />
                              </tr>
                            </thead>
                            <tbody>
                              {expandedData.grants.map((g) => (
                                <TeamPermissionRow
                                  key={g.grantId}
                                  grant={g}
                                  onRevoke={handleRevokeGrant}
                                />
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Create Team Modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Team"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              intent="success"
              loading={creating}
              onClick={handleCreate}
              disabled={!newName.trim() || !newSlug.trim()}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-4">
          <FormField label="Team name" required>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Engineering"
            />
          </FormField>
          <FormField label="Slug" required hint="URL-friendly identifier">
            <Input
              value={newSlug}
              onChange={(e) =>
                setNewSlug(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                )
              }
              placeholder="engineering"
            />
          </FormField>
          <FormField label="Description">
            <Input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description"
            />
          </FormField>
        </div>
      </Modal>

      {/* Rename Modal */}
      <Modal
        isOpen={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename Team"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRenameOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRename}
              disabled={!renameName.trim()}
            >
              Rename
            </Button>
          </>
        }
      >
        <div className="p-5">
          <FormField label="Team name" required>
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
            />
          </FormField>
        </div>
      </Modal>

      {/* Add Grant Modal */}
      <Modal
        isOpen={grantOpen}
        onClose={() => setGrantOpen(false)}
        title="Add Permission"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setGrantOpen(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              intent="success"
              onClick={handleAddGrant}
              disabled={!grantResourceId.trim()}
            >
              Grant
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-4">
          <FormField label="Resource type">
            <select
              className="select select-bordered w-full rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark text-sm focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)]"
              value={grantResourceType}
              onChange={(e) => setGrantResourceType(e.target.value)}
            >
              <option value="workspace">workspace</option>
              <option value="project">project</option>
            </select>
          </FormField>
          <FormField label="Resource ID" required>
            <Input
              value={grantResourceId}
              onChange={(e) => setGrantResourceId(e.target.value)}
              placeholder="workspace-id-here"
            />
          </FormField>
          <FormField
            label="Permissions"
            hint="Comma-separated: read, write, admin"
          >
            <Input
              value={grantPermissions}
              onChange={(e) => setGrantPermissions(e.target.value)}
              placeholder="write"
            />
          </FormField>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteConfirmed}
        title="Delete Team"
        message={
          <>
            Delete team{" "}
            <span className="font-medium text-text-primary dark:text-text-primary-dark">
              {deleteConfirm?.name}
            </span>
            ? This will remove all members and permissions.
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        intent="error"
      />
    </>
  );
}
