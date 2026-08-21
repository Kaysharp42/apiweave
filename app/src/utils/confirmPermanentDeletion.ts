import { toast } from "sonner";

/**
 * Shared tail of the sidebar's permanent-delete flows: awaits the deletion
 * request, requires both the confirmation flag and the entity id the server
 * echoes back, and announces success. Returns the id so each caller can run
 * its own cleanup — selection, open tabs, and expanded sets differ per
 * entity — or null when nothing was deleted.
 */
export async function confirmPermanentDeletion(
  request: Promise<{
    readonly deleted: boolean;
    readonly workflowId?: string;
    readonly projectId?: string;
  }>,
  entityLabel: string,
): Promise<string | null> {
  const result = await request;
  const entityId = result.workflowId ?? result.projectId;
  if (!result.deleted || !entityId) return null;

  toast.success(`${entityLabel} deleted permanently`);
  return entityId;
}
