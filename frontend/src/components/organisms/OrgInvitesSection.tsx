import { useState, useEffect, useCallback } from "react";
import { Mail, Plus } from "lucide-react";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { Input } from "../atoms/Input";
import { EmptyState } from "../molecules/EmptyState";
import { Panel } from "../molecules/Panel";
import { Modal } from "../molecules/Modal";
import { FormField } from "../molecules/FormField";
import { InviteRow } from "../molecules/InviteRow";
import {
  authenticatedJson,
  authenticatedFetch,
} from "../../utils/authenticatedApi";
import API_BASE_URL from "../../utils/api";
import type { OrgInvite, OrgInviteCreate, OrgRole } from "../../types";
import { toast } from "sonner";

export interface OrgInvitesSectionProps {
  orgSlug: string;
  orgId: string;
}

const INVITE_ROLES: OrgRole[] = ["member", "billing", "security"];

export function OrgInvitesSection({ orgSlug }: OrgInvitesSectionProps) {
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<OrgRole>("member");
  const [inviting, setInviting] = useState(false);
  const [lastCreated, setLastCreated] = useState<OrgInviteCreate | null>(null);

  const [resendingId, setResendingId] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<OrgInvite[]>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/invites`,
      );
      setInvites(data);
    } catch {
      toast.error("Failed to load invites");
    } finally {
      setLoading(false);
    }
  }, [orgSlug]);

  useEffect(() => {
    void fetchInvites();
  }, [fetchInvites]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    try {
      const created = await authenticatedJson<OrgInviteCreate>(
        `${API_BASE_URL}/api/orgs/${orgSlug}/invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        },
      );
      setLastCreated(created);
      toast.success(`Invite sent to ${created.email}`);
      // Refresh list
      await fetchInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const handleResend = async (inviteId: string) => {
    setResendingId(inviteId);
    // Backend doesn't have a dedicated resend endpoint — cancel and re-create
    // For now, just show a toast indicating the action
    toast.info("Resend not available — cancel and re-invite");
    setTimeout(() => setResendingId(null), 1000);
  };

  const handleCancel = async (inviteId: string) => {
    try {
      await authenticatedFetch(
        `${API_BASE_URL}/api/orgs/${orgSlug}/invites/${inviteId}`,
        { method: "DELETE" },
      );
      setInvites((prev) => prev.filter((inv) => inv.inviteId !== inviteId));
      toast.success("Invite cancelled");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel invite",
      );
    }
  };

  const pendingInvites = invites.filter((inv) => !inv.consumed);

  return (
    <>
      <Panel
        title="Invites"
        icon={Mail}
        headerActions={
          <Button
            size="xs"
            variant="primary"
            onClick={() => {
              setLastCreated(null);
              setInviteOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            Invite
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
        ) : pendingInvites.length === 0 ? (
          <EmptyState
            title="No pending invites"
            description="Invite people to join your organization."
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setLastCreated(null);
                  setInviteOpen(true);
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Send Invite
              </Button>
            }
          />
        ) : (
          <div className="overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-text-secondary dark:text-text-secondary-dark uppercase bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark">
                <tr>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3">Role</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Expires</th>
                  <th className="px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((inv) => (
                  <InviteRow
                    key={inv.inviteId}
                    invite={inv}
                    onResend={handleResend}
                    onCancel={handleCancel}
                    resending={resendingId === inv.inviteId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Invite Modal */}
      <Modal
        isOpen={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite Member"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInviteOpen(false)}
            >
              {lastCreated ? "Close" : "Cancel"}
            </Button>
            {!lastCreated && (
              <Button
                size="sm"
                intent="success"
                loading={inviting}
                onClick={handleInvite}
                disabled={!inviteEmail.trim()}
              >
                Send Invite
              </Button>
            )}
          </>
        }
      >
        <div className="p-5 space-y-4">
          {lastCreated ? (
            <div className="text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-full bg-status-success/10 flex items-center justify-center border border-status-success/20">
                <Mail className="w-6 h-6 text-status-success" />
              </div>
              <p className="text-sm text-text-primary dark:text-text-primary-dark">
                Invite sent to{" "}
                <span className="font-semibold">{lastCreated.email}</span>
              </p>
              <p className="text-xs text-text-muted dark:text-text-muted-dark">
                Expires {new Date(lastCreated.expires_at).toLocaleDateString()}
              </p>
            </div>
          ) : (
            <>
              <FormField label="Email address" required>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="member@example.com"
                />
              </FormField>
              <FormField label="Role">
                <select
                  className="select select-bordered w-full rounded bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark border-border dark:border-border-dark text-sm focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)]"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                >
                  {INVITE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
