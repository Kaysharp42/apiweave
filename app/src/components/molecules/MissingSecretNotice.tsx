import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../atoms/Button";
import { Modal } from "./Modal";
import { SecretForm } from "../SecretForm";
import { useSecretNamesInScope } from "../../hooks/useSecretNamesInScope";
import type { MissingSecretNoticeProps } from "../../types";

/**
 * Says that a step's `{{secrets.NAME}}` is not set where the workflow runs —
 * a recorded password that matched no stored secret gets such a placeholder —
 * and offers to save it. Renders nothing once the name resolves, or while the
 * list of names is still loading.
 */
export function MissingSecretNotice({ name }: MissingSecretNoticeProps) {
  const { names, workspaceId, refresh } = useSecretNamesInScope();
  const [saving, setSaving] = useState(false);
  if (names === null || names.includes(name) || workspaceId === null) return null;

  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-xs border border-(--aw-status-warning)/40 bg-(--aw-status-warning)/10 px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark"
      role="status"
    >
      <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-(--aw-status-warning)" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p>
          The secret <span className="font-mono">{name}</span> is not set, so a run fails this step. Save the password as
          that secret, or type <span className="font-mono">{"{{"}</span> above to pick one you already have.
        </p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => setSaving(true)}>
          Save as secret
        </Button>
      </div>
      <Modal isOpen={saving} onClose={() => setSaving(false)} title="Save a workspace secret" size="sm">
        <div className="p-5">
          <SecretForm
            scopeType="workspace"
            scopeId={workspaceId}
            defaultName={name}
            onCreated={() => {
              setSaving(false);
              refresh();
              toast.success(`Saved secret ${name}`);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
