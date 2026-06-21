import { useState, useEffect, useCallback } from 'react';
import { UserCircle, Trash2 } from 'lucide-react';
import { IconButton } from '../atoms/IconButton';
import { Spinner } from '../atoms/Spinner';
import { Badge } from '../atoms/Badge';
import { EmptyState } from '../molecules/EmptyState';
import { Panel } from '../molecules/Panel';
import { ConfirmDialog } from '../molecules/ConfirmDialog';
import { authenticatedJson, authenticatedFetch } from '../../utils/authenticatedApi';
import API_BASE_URL from '../../utils/api';
import type { OutsideCollaborator } from '../../types';
import { toast } from 'sonner';

export interface OutsideCollaboratorListProps {
  workspaceId: string;
}

interface CollaboratorsResponse {
  collaborators: OutsideCollaborator[];
  total: number;
}

export function OutsideCollaboratorList({ workspaceId }: OutsideCollaboratorListProps) {
  const [collaborators, setCollaborators] = useState<OutsideCollaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [removeConfirm, setRemoveConfirm] = useState<OutsideCollaborator | null>(null);
  const [removing, setRemoving] = useState(false);

  const fetchCollaborators = useCallback(async () => {
    try {
      setLoading(true);
      const data = await authenticatedJson<CollaboratorsResponse>(
        `${API_BASE_URL}/api/workspaces/${workspaceId}/collaborators`,
      );
      setCollaborators(data.collaborators);
    } catch {
      // Silently fail — workspace may not have collaborators endpoint available
      setCollaborators([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void fetchCollaborators();
  }, [fetchCollaborators]);

  const handleRemoveConfirmed = async () => {
    if (!removeConfirm) return;
    setRemoving(true);
    try {
      await authenticatedFetch(
        `${API_BASE_URL}/api/workspaces/${workspaceId}/collaborators/${removeConfirm.collaboratorId}`,
        { method: 'DELETE' },
      );
      setCollaborators((prev) =>
        prev.filter((c) => c.collaboratorId !== removeConfirm.collaboratorId),
      );
      toast.success('Collaborator removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
      setRemoveConfirm(null);
    }
  };

  return (
    <>
      <Panel title="Outside Collaborators" icon={UserCircle}>
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner size="md" className="text-primary dark:text-primary-light" />
          </div>
        ) : collaborators.length === 0 ? (
          <EmptyState
            title="No outside collaborators"
            description="External users with access to this workspace will appear here."
          />
        ) : (
          <div className="divide-y divide-border dark:divide-border-dark">
            {collaborators.map((collab) => (
              <div
                key={collab.collaboratorId}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <UserCircle className="w-5 h-5 text-text-muted dark:text-text-muted-dark flex-shrink-0" />
                  <div className="min-w-0">
                    <span className="text-sm font-mono text-text-primary dark:text-text-primary-dark truncate block">
                      {collab.userId.slice(0, 12)}…
                    </span>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      Added {new Date(collab.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="info" size="xs">
                    {collab.role}
                  </Badge>
                  <IconButton
                    tooltip="Remove collaborator"
                    variant="error"
                    size="xs"
                    onClick={() => setRemoveConfirm(collab)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={!!removeConfirm}
        onClose={() => setRemoveConfirm(null)}
        onConfirm={handleRemoveConfirmed}
        title="Remove Collaborator"
        message={
          <>
            Remove this outside collaborator from the workspace?
            {removing && <Spinner size="sm" className="ml-2" />}
          </>
        }
        confirmLabel="Remove"
        cancelLabel="Cancel"
        intent="warning"
      />
    </>
  );
}
