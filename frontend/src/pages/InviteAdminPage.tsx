import { useState, type FormEvent } from "react";
import { Mail, Copy, Trash2, Plus } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { useInvites } from "../hooks/useInvites";
import { copyInviteLink } from "../utils/apiweaveClient";
import { Button } from "../components/atoms/Button";
import { Spinner } from "../components/atoms/Spinner";
import { Input } from "../components/atoms/Input";
import { EmptyState } from "../components/molecules/EmptyState";
import { Panel } from "../components/molecules/Panel";
import { Card } from "../components/molecules/Card";
import { StatusBadge } from "../components/molecules/StatusBadge";
import { ConfirmDialog } from "../components/molecules/ConfirmDialog";
import { toast } from "sonner";
import type { Invite } from "../types";

export default function InviteAdminPage() {
  const { hasPermission } = useAuth();
  const { invites, loading, createInvite, revokeInvite } = useInvites();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [submitting, setSubmitting] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [selectedInvite, setSelectedInvite] = useState<Invite | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    email: string;
  } | null>(null);

  if (!hasPermission("invites:create")) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          <Mail className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
          <div>
            <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
              Invite Management
            </h1>
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
              Create and monitor administrative invitations.
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState
            icon={
              <Mail
                className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
                strokeWidth={1.5}
              />
            }
            title="Access denied"
            description="You need admin privileges to manage invitations."
          />
        </div>
      </div>
    );
  }

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setPendingLink(null);
    try {
      const result = await createInvite(email.trim(), role);
      if (result?.link) {
        setPendingLink(result.link);
      }
      if (result) {
        setEmail("");
        setSelectedInvite(result.invite);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyLink = async (inviteId: string, link: string) => {
    const success = await copyInviteLink(link);
    if (success) {
      setCopiedId(inviteId);
      toast.success("Invite link copied");
      setTimeout(() => setCopiedId(null), 1500);
    } else {
      toast.error("Failed to copy invite link");
    }
  };

  const handleCopyPendingLink = async () => {
    if (!pendingLink) return;
    const success = await copyInviteLink(pendingLink);
    if (success) {
      toast.success("Invite link copied");
    } else {
      toast.error("Failed to copy invite link");
    }
  };

  const handleRevokeConfirmed = async () => {
    if (!revokeTarget) return;
    try {
      await revokeInvite(revokeTarget.id);
      setSelectedInvite((current) =>
        current?.id === revokeTarget.id ? null : current,
      );
    } finally {
      setRevokeTarget(null);
    }
  };

  const formatExpiry = (expiresAt: string) => {
    const d = new Date(expiresAt);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-6 border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <Mail className="w-5 h-5 text-text-secondary dark:text-text-secondary-dark" />
        <div>
          <h1 className="text-3xl font-bold font-display tracking-tight text-text-primary dark:text-text-primary-dark">
            Invite Management
          </h1>
          <p className="text-xs text-text-secondary dark:text-text-secondary-dark">
            Create and monitor administrative invitations.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex justify-end">
              <Button
                type="submit"
                form="create-invite-form"
                loading={submitting}
                disabled={!email.trim()}
                variant="primary"
                intent="success"
                size="sm"
                icon={<Plus className="w-4 h-4" />}
              >
                Send Invite
              </Button>
            </div>

            {/* Create invite form */}
            <Panel title="Create Invitation">
              <form
                id="create-invite-form"
                onSubmit={handleCreate}
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end"
              >
                <div className="flex-1">
                  <label
                    htmlFor="invite-email"
                    className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-1"
                  >
                    Email Address
                  </label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="user@example.com"
                    disabled={submitting}
                    required
                  />
                </div>
                <div className="sm:w-40">
                  <label
                    htmlFor="invite-role"
                    className="block text-sm font-medium text-text-primary dark:text-text-primary-dark mb-1"
                  >
                    Role
                  </label>
                  <select
                    id="invite-role"
                    className="select select-bordered w-full bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out cursor-pointer"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    disabled={submitting}
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              </form>

              {/* Copy link banner when SMTP not configured */}
              {pendingLink && (
                <div className="mt-4 p-4 rounded bg-status-warning/10 border border-status-warning/20">
                  <p className="text-sm text-text-primary dark:text-text-primary-dark mb-2">
                    Email not sent — SMTP is not configured. Share this link
                    manually:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono truncate bg-surface dark:bg-surface-dark px-3 py-2 rounded border border-border dark:border-border-dark">
                      {pendingLink}
                    </code>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={handleCopyPendingLink}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1" />
                      Copy Link
                    </Button>
                  </div>
                </div>
              )}
            </Panel>

            {/* Pending invites list */}
            <Panel title="Pending Invitations">
              {loading ? (
                <div className="flex justify-center p-12 text-text-muted">
                  <Spinner
                    size="lg"
                    className="text-primary dark:text-primary-light"
                  />
                </div>
              ) : invites.length === 0 ? (
                <EmptyState
                  title="No pending invitations"
                  description="Create an invitation using the form above."
                />
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
                      <tr>
                        <th className="px-6 py-4">Email</th>
                        <th className="px-6 py-4">Role</th>
                        <th className="px-6 py-4">Expires</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invites.map((inv) => (
                        <tr
                          key={inv.id}
                          className={`border-b border-border dark:border-border-dark last:border-0 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors focus-within:outline-2 focus-within:outline-[var(--aw-primary)] focus-within:outline-offset-[-2px] cursor-pointer ${selectedInvite?.id === inv.id ? "bg-primary/5 dark:bg-primary-light/10" : ""}`}
                          tabIndex={0}
                          onClick={() => setSelectedInvite(inv)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedInvite(inv);
                            }
                          }}
                        >
                          <td className="px-6 py-4 font-medium">{inv.email}</td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-0.5 bg-primary/10 text-primary dark:text-primary-light rounded-full text-xs font-medium">
                              {inv.role}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-text-secondary dark:text-text-secondary-dark">
                            {formatExpiry(inv.expiresAt)}
                          </td>
                          <td className="px-6 py-4">
                            <StatusBadge status="warning" label="Pending" />
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              {inv.token && (
                                <Button
                                  size="xs"
                                  variant="outline"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCopyLink(inv.id, inv.token!);
                                  }}
                                >
                                  <Copy className="w-3.5 h-3.5 mr-1" />
                                  {copiedId === inv.id
                                    ? "Copied!"
                                    : "Copy Link"}
                                </Button>
                              )}
                              <Button
                                size="xs"
                                variant="outline"
                                intent="error"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRevokeTarget({
                                    id: inv.id,
                                    email: inv.email,
                                  });
                                }}
                              >
                                <Trash2 className="w-3.5 h-3.5 mr-1" />
                                Revoke
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            {selectedInvite ? (
              <Card title={selectedInvite.email}>
                <div className="space-y-3">
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Email
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark break-all">
                      {selectedInvite.email}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Role
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {selectedInvite.role}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Expires
                    </span>
                    <p className="text-sm text-text-primary dark:text-text-primary-dark">
                      {formatExpiry(selectedInvite.expiresAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Status
                    </span>
                    <div className="mt-1">
                      <StatusBadge status="warning" label="Pending" />
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Link
                    </span>
                    {selectedInvite.token ? (
                      <div className="mt-1 flex items-center gap-2">
                        <code className="min-w-0 flex-1 truncate rounded border border-border bg-surface px-2 py-1.5 text-xs font-mono text-text-primary dark:border-border-dark dark:bg-surface-dark dark:text-text-primary-dark">
                          {selectedInvite.token}
                        </code>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            handleCopyLink(
                              selectedInvite.id,
                              selectedInvite.token!,
                            )
                          }
                        >
                          <Copy className="w-3.5 h-3.5 mr-1" />
                          {copiedId === selectedInvite.id ? "Copied!" : "Copy"}
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
                        Link unavailable after creation.
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            ) : (
              <EmptyState
                icon={
                  <Mail
                    className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
                    strokeWidth={1.5}
                  />
                }
                title="Select an invitation"
                description="Choose a pending invitation to view details or revoke."
              />
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeConfirmed}
        title="Revoke Invitation"
        message={
          <>
            Are you sure you want to revoke the invitation for{" "}
            <span className="font-medium text-text-primary dark:text-text-primary-dark">
              {revokeTarget?.email}
            </span>
            ? This action cannot be undone.
          </>
        }
        confirmLabel="Revoke"
        cancelLabel="Cancel"
        intent="error"
      />
    </div>
  );
}
